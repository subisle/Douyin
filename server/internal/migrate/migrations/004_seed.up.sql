-- 默认等级规则（沿用 615 分支 tier_rules 的口径）
-- INSERT IGNORE 保证重跑不炸、不覆盖人工调整过的阈值。

INSERT IGNORE INTO tier_rule (scope, label, min_wave, sort_order) VALUES
  ('daily',   'A', 500000, 4),
  ('daily',   'B', 200000, 3),
  ('daily',   'C',  50000, 2),
  ('daily',   'D',      0, 1),
  ('monthly', 'A', 500000, 4),
  ('monthly', 'B', 200000, 3),
  ('monthly', 'C',  50000, 2),
  ('monthly', 'D',      0, 1),
  ('yearly',  'A', 500000, 4),
  ('yearly',  'B', 200000, 3),
  ('yearly',  'C',  50000, 2),
  ('yearly',  'D',      0, 1);
