require("dotenv").config();
const mysql = require("mysql2/promise");

(async () => {
  const db = await mysql.createPool({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    dateStrings: true,
  });

  // 插入鹏先生 id=159
  await db.query(
    "INSERT IGNORE INTO persons (id, name, gender, master_id, generation, created_at, updated_at) VALUES (159, ?, ?, NULL, 0, NOW(), NOW())",
    ["鹏先生", "male"]
  );
  console.log("已插入鹏先生 id=159");

  // 插入女队师父 id=160
  await db.query(
    "INSERT IGNORE INTO persons (id, name, gender, master_id, generation, created_at, updated_at) VALUES (160, ?, ?, NULL, 0, NOW(), NOW())",
    ["晓0", "female"]
  );
  console.log("已插入晓0 id=160");

  // 插入狼彬师父 id=161
  await db.query(
    "INSERT IGNORE INTO persons (id, name, gender, master_id, generation, created_at, updated_at) VALUES (161, ?, ?, NULL, 0, NOW(), NOW())",
    ["狼0", "male"]
  );
  console.log("已插入狼0 id=161");

  await db.end();
})();