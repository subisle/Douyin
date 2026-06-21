const db = require("./electron/db.js");

// 师徒关系：师父 → 徒弟列表
const TREE = {
  鹏先生: ["浩雨", "浩延", "浩冬", "浩文", "南方楠"],
  浩雨: ["狼俊", "狼艺", "狼兴", "狼旭", "狼征", "狼赫", "狼澈"],
  浩延: ["狼沐"],
  浩冬: ["狼森", "狼影", "狼裕", "狼九", "狼雨"],
  浩文: ["狼帅", "狼彬"],
  南方楠: ["狼轩", "狼仔", "狼腾", "狼辉", "狼凯", "玖豆"],
  狼兴: ["啸辰", "啸泽", "啸安", "啸帆"],
  狼俊: ["啸宇", "啸森", "啸强"],
  狼征: ["啸沐"],
};

// 代数
const GENERATION = { 鹏先生: 0, 微姐: 0 };
const GEN1 = ["浩雨", "浩延", "浩冬", "浩文", "南方楠"];
const GEN2 = [
  "狼俊", "狼艺", "狼兴", "狼旭", "狼征", "狼赫", "狼澈",
  "狼沐", "狼森", "狼影", "狼裕", "狼九", "狼雨",
  "狼帅", "狼彬", "狼轩", "狼仔", "狼腾", "狼辉", "狼凯", "玖豆",
];
const GEN3 = ["啸辰", "啸泽", "啸安", "啸帆", "啸宇", "啸森", "啸强", "啸沐"];
GEN1.forEach((n) => (GENERATION[n] = 1));
GEN2.forEach((n) => (GENERATION[n] = 2));
GEN3.forEach((n) => (GENERATION[n] = 3));

// 需要新建的人 (name -> gender)
const NEW_PERSONS = [
  ["鹏先生", "male"],
  ["微姐", "female"],
  ["浩文", "male"],
  ["狼沐", "male"],
  ["狼雨", "male"],
];

(async () => {
  const pool = db.getPool();

  // 1. 新建缺失的人（按名字判重，避免重复插入）
  for (const [name, gender] of NEW_PERSONS) {
    const [exist] = await pool.query(
      "SELECT id FROM persons WHERE name = ? LIMIT 1",
      [name]
    );
    if (exist.length === 0) {
      await pool.query(
        "INSERT INTO persons (name, gender) VALUES (?, ?)",
        [name, gender]
      );
      console.log("➕ 新建", name);
    } else {
      console.log("·  已存在", name);
    }
  }

  // 2. 名字 → id 映射（男队相关人物名字唯一，安全）
  const [persons] = await pool.query("SELECT id, name, gender FROM persons");
  const idByName = new Map();
  for (const p of persons) {
    // 保留首个出现的 id（被点名的都是唯一名）
    if (!idByName.has(p.name)) idByName.set(p.name, p.id);
  }
  const idOf = (name) => {
    const id = idByName.get(name);
    if (!id) throw new Error("找不到人: " + name);
    return id;
  };

  // 3. 设置师徒 master_id
  let edges = 0;
  for (const [master, disciples] of Object.entries(TREE)) {
    const masterId = idOf(master);
    for (const d of disciples) {
      await pool.query("UPDATE persons SET master_id = ? WHERE id = ?", [
        masterId,
        idOf(d),
      ]);
      edges++;
    }
  }
  console.log("🔗 设置师徒关系", edges, "条");

  // 4. 设置代数
  for (const [name, gen] of Object.entries(GENERATION)) {
    await pool.query("UPDATE persons SET generation = ? WHERE id = ?", [
      gen,
      idOf(name),
    ]);
  }
  console.log("🏷  设置代数", Object.keys(GENERATION).length, "人");

  // 5. 祖师爷置顶：master_id = null
  await pool.query(
    "UPDATE persons SET master_id = NULL WHERE name IN ('鹏先生','微姐')"
  );

  // 6. 女主播全部挂到微姐（gen=1），排除微姐自己
  const weijieId = idOf("微姐");
  const [fres] = await pool.query(
    "UPDATE persons SET master_id = ?, generation = 1 WHERE gender = 'female' AND id <> ?",
    [weijieId, weijieId]
  );
  await pool.query(
    "UPDATE persons SET master_id = NULL, generation = 0 WHERE id = ?",
    [weijieId]
  );
  console.log("👩 女主播挂到微姐:", fres.affectedRows, "人");

  console.log("✅ 完成");
  process.exit(0);
})().catch((e) => {
  console.error("❌", e.message);
  process.exit(1);
});
