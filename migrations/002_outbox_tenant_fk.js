"use strict";

const INBOX_SCOPE_INDEX = "uq_inbox_scope_id";
const OUTBOX_REPLY_FOREIGN_KEY = "fk_outbox_inbox_scope";
const INBOX_SCOPE_COLUMNS = Object.freeze([
  "workspace_id",
  "account_id",
  "id",
]);
const OUTBOX_REPLY_COLUMNS = Object.freeze([
  "workspace_id",
  "account_id",
  "reply_to_inbox_id",
]);

function quoteIdentifier(value) {
  return `\`${String(value).replaceAll("`", "``")}\``;
}

function sameColumns(actual, expected) {
  return (
    actual.length === expected.length &&
    actual.every((column, index) => column === expected[index])
  );
}

function groupIndexes(rows) {
  const indexes = new Map();
  for (const row of rows) {
    const name = String(row.indexName);
    const index = indexes.get(name) || {
      unique: Number(row.nonUnique) === 0,
      columns: [],
    };
    index.columns.push({
      sequenceNumber: Number(row.sequenceNumber),
      columnName: String(row.columnName),
    });
    indexes.set(name, index);
  }
  return indexes;
}

async function ensureInboxScopeIndex(db) {
  const [rows] = await db.query(
    `SELECT index_name AS indexName,
            non_unique AS nonUnique,
            seq_in_index AS sequenceNumber,
            column_name AS columnName
       FROM information_schema.statistics
      WHERE table_schema = DATABASE()
        AND table_name = 'inbox_messages'
      ORDER BY index_name, seq_in_index`
  );
  const indexes = groupIndexes(rows);
  const hasRequiredIndex = Array.from(indexes.values()).some((index) => {
    const columns = index.columns
      .sort((left, right) => left.sequenceNumber - right.sequenceNumber)
      .map((item) => item.columnName);
    return index.unique && sameColumns(columns, INBOX_SCOPE_COLUMNS);
  });
  if (hasRequiredIndex) return;

  const clauses = [];
  if (indexes.has(INBOX_SCOPE_INDEX)) {
    clauses.push(`DROP INDEX ${quoteIdentifier(INBOX_SCOPE_INDEX)}`);
  }
  clauses.push(
    `ADD UNIQUE KEY ${quoteIdentifier(INBOX_SCOPE_INDEX)} ` +
      `(${INBOX_SCOPE_COLUMNS.map(quoteIdentifier).join(", ")})`
  );
  await db.query(`ALTER TABLE inbox_messages\n  ${clauses.join(",\n  ")}`);
}

function groupForeignKeys(rows) {
  const constraints = new Map();
  for (const row of rows) {
    const name = String(row.constraintName);
    const constraint = constraints.get(name) || {
      name,
      columns: [],
      referencedColumns: [],
      updateRule: String(row.updateRule || "").toUpperCase(),
      deleteRule: String(row.deleteRule || "").toUpperCase(),
    };
    constraint.columns.push({
      position: Number(row.position),
      name: String(row.columnName),
    });
    constraint.referencedColumns.push({
      position: Number(row.position),
      name: String(row.referencedColumnName),
    });
    constraints.set(name, constraint);
  }
  return Array.from(constraints.values()).map((constraint) => ({
    ...constraint,
    columns: constraint.columns
      .sort((left, right) => left.position - right.position)
      .map((column) => column.name),
    referencedColumns: constraint.referencedColumns
      .sort((left, right) => left.position - right.position)
      .map((column) => column.name),
  }));
}

function isRestrictRule(rule) {
  return rule === "RESTRICT" || rule === "NO ACTION";
}

function isTenantScopedReplyForeignKey(constraint) {
  return (
    sameColumns(constraint.columns, OUTBOX_REPLY_COLUMNS) &&
    sameColumns(constraint.referencedColumns, INBOX_SCOPE_COLUMNS) &&
    isRestrictRule(constraint.updateRule) &&
    isRestrictRule(constraint.deleteRule)
  );
}

async function assertReplyTenantsMatch(db) {
  const [rows] = await db.query(
    `SELECT COUNT(*) AS invalidReplyCount
       FROM outbox_messages AS outbox
       LEFT JOIN inbox_messages AS inbox
         ON inbox.id = outbox.reply_to_inbox_id
      WHERE outbox.reply_to_inbox_id IS NOT NULL
        AND (
          inbox.id IS NULL OR
          inbox.workspace_id <> outbox.workspace_id OR
          inbox.account_id <> outbox.account_id
        )`
  );
  const invalidReplyCount = Number(rows[0]?.invalidReplyCount) || 0;
  if (invalidReplyCount > 0) {
    throw new Error(
      `Cannot enforce tenant-scoped outbox replies: ${invalidReplyCount} ` +
        "rows reference a missing or cross-tenant inbox message"
    );
  }
}

async function ensureTenantScopedReplyForeignKey(db) {
  const [rows] = await db.query(
    `SELECT kcu.constraint_name AS constraintName,
            kcu.ordinal_position AS position,
            kcu.column_name AS columnName,
            kcu.referenced_column_name AS referencedColumnName,
            rc.update_rule AS updateRule,
            rc.delete_rule AS deleteRule
       FROM information_schema.key_column_usage AS kcu
       JOIN information_schema.referential_constraints AS rc
         ON rc.constraint_schema = kcu.constraint_schema
        AND rc.table_name = kcu.table_name
        AND rc.constraint_name = kcu.constraint_name
      WHERE kcu.constraint_schema = DATABASE()
        AND kcu.table_name = 'outbox_messages'
        AND kcu.referenced_table_name = 'inbox_messages'
      ORDER BY kcu.constraint_name, kcu.ordinal_position`
  );
  const constraints = groupForeignKeys(rows);
  const desired = constraints.find(isTenantScopedReplyForeignKey);
  const obsolete = constraints.filter((constraint) => constraint !== desired);
  if (desired && obsolete.length === 0) return;

  const clauses = obsolete.map(
    (constraint) => `DROP FOREIGN KEY ${quoteIdentifier(constraint.name)}`
  );
  if (!desired) {
    clauses.push(
      `ADD CONSTRAINT ${quoteIdentifier(OUTBOX_REPLY_FOREIGN_KEY)}\n` +
        `    FOREIGN KEY (${OUTBOX_REPLY_COLUMNS.map(quoteIdentifier).join(", ")})\n` +
        `    REFERENCES ${quoteIdentifier("inbox_messages")} ` +
        `(${INBOX_SCOPE_COLUMNS.map(quoteIdentifier).join(", ")})\n` +
        "    ON UPDATE RESTRICT ON DELETE RESTRICT"
    );
  }
  await db.query(`ALTER TABLE outbox_messages\n  ${clauses.join(",\n  ")}`);
}

module.exports = {
  id: "002_outbox_tenant_fk",
  name: "Enforce tenant-scoped outbox reply references",
  async up(db) {
    await assertReplyTenantsMatch(db);
    await ensureInboxScopeIndex(db);
    await ensureTenantScopedReplyForeignKey(db);
  },
};
