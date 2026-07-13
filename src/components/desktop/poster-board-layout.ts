/** Auto-derived from PSD templates. Coordinates are in template pixel space.
 *  文字用 SVG <text> + PSD transform 基线定位（不是 HTML top 盒模型）。
 *  name: font-size 23.978 * matrix(~1.251168)
 *  top:  font-size 17 * matrix(Top1~1.76018, Top2/3~1.51305)
 *  由 scripts/sync-poster-from-psd.py 生成，请勿手改坐标。
 */
export type PosterBoardSlot = {
  rank: number;
  kind: "top" | "name";
  x: number;
  y: number;
  w: number;
  h: number;
  cx: number;
  cy: number;
  /** 有效视觉字号（base*sx），仅参考 */
  fontSize: number;
  /** PSD/CSS 原始 font-size（未乘 matrix） */
  baseFontSize: number;
  sx: number;
  sy: number;
  /** PSD transform 平移 = 文本基线原点 */
  tx: number;
  ty: number;
};

/** Top 头像位，用于叠加透明 PNG */
export type PosterBoardAvatarSlot = {
  rank: number;
  x: number;
  y: number;
  w: number;
  h: number;
};

export type PosterBoardTemplate = {
  id: string;
  label: string;
  width: number;
  height: number;
  image: string;
  rankStart: number;
  rankEnd: number;
  slots: PosterBoardSlot[];
  avatarSlots?: PosterBoardAvatarSlot[];
};

export const POSTER_BOARD_TEMPLATES: PosterBoardTemplate[] = [
  {
    id: "male-1-40",
    label: "男团 1-40",
    width: 926,
    height: 1698,
    image: "posters/male-1-40.png",
    rankStart: 1,
    rankEnd: 40,
    slots: [
      { rank: 1, kind: "top", x: 372, y: 760, w: 202, h: 43, cx: 473, cy: 781.5, fontSize: 29.9231, baseFontSize: 17, sx: 1.760180438224, sy: 1.760180438224, tx: 367.956737591247, ty: 794.279092516448 },
      { rank: 2, kind: "top", x: 118, y: 779, w: 178, h: 37, cx: 207, cy: 797.5, fontSize: 25.7218, baseFontSize: 17, sx: 1.513049885491, sy: 1.513049885491, tx: 114.056682373135, ty: 808.513143891136 },
      { rank: 3, kind: "top", x: 640, y: 790, w: 177, h: 37, cx: 728.5, cy: 808.5, fontSize: 25.7218, baseFontSize: 17, sx: 1.513049885491, sy: 1.513049885491, tx: 636.056682373135, ty: 819.513143891136 },
      { rank: 4, kind: "name", x: 242, y: 864, w: 60, h: 29, cx: 272, cy: 878.5, fontSize: 30.0005, baseFontSize: 23.978, sx: 1.251168049794, sy: 1.251168049794, tx: 240.318999283921, ty: 889.739470040524 },
      { rank: 5, kind: "name", x: 242, y: 902, w: 61, h: 29, cx: 272.5, cy: 916.5, fontSize: 30.0005, baseFontSize: 23.978, sx: 1.251168049794, sy: 1.251168049794, tx: 240.318999283921, ty: 927.739470040524 },
      { rank: 6, kind: "name", x: 242, y: 947, w: 61, h: 29, cx: 272.5, cy: 961.5, fontSize: 30.0005, baseFontSize: 23.978, sx: 1.251168049794, sy: 1.251168049794, tx: 240.318999283921, ty: 972.739470040524 },
      { rank: 7, kind: "name", x: 241, y: 987, w: 61, h: 29, cx: 271.5, cy: 1001.5, fontSize: 30.0005, baseFontSize: 23.978, sx: 1.251168049794, sy: 1.251168049794, tx: 239.318999283921, ty: 1012.739470040524 },
      { rank: 8, kind: "name", x: 242, y: 1032, w: 61, h: 29, cx: 272.5, cy: 1046.5, fontSize: 30.0005, baseFontSize: 23.978, sx: 1.251168049794, sy: 1.251168049794, tx: 240.318999283921, ty: 1057.739470040524 },
      { rank: 9, kind: "name", x: 242, y: 1077, w: 61, h: 29, cx: 272.5, cy: 1091.5, fontSize: 30.0005, baseFontSize: 23.978, sx: 1.251168049794, sy: 1.251168049794, tx: 240.318999283921, ty: 1102.739470040524 },
      { rank: 10, kind: "name", x: 242, y: 1122, w: 62, h: 29, cx: 273, cy: 1136.5, fontSize: 30.0005, baseFontSize: 23.978, sx: 1.251168049794, sy: 1.251168049794, tx: 240.318999283921, ty: 1147.739470040524 },
      { rank: 11, kind: "name", x: 243, y: 1161, w: 61, h: 30, cx: 273.5, cy: 1176, fontSize: 30.0005, baseFontSize: 23.978, sx: 1.251168049794, sy: 1.251168049794, tx: 241.318999283921, ty: 1187.739470040524 },
      { rank: 12, kind: "name", x: 241, y: 1207, w: 62, h: 29, cx: 272, cy: 1221.5, fontSize: 30.0005, baseFontSize: 23.978, sx: 1.251168049794, sy: 1.251168049794, tx: 240.318999283921, ty: 1232.739470040524 },
      { rank: 13, kind: "name", x: 243, y: 1250, w: 92, h: 29, cx: 289, cy: 1264.5, fontSize: 30.0005, baseFontSize: 23.978, sx: 1.251168049794, sy: 1.251168049794, tx: 240.318999283921, ty: 1275.739470040524 },
      { rank: 14, kind: "name", x: 242, y: 1292, w: 61, h: 29, cx: 272.5, cy: 1306.5, fontSize: 30.0005, baseFontSize: 23.978, sx: 1.251168049794, sy: 1.251168049794, tx: 240.318999283921, ty: 1317.739470040524 },
      { rank: 15, kind: "name", x: 242, y: 1337, w: 59, h: 29, cx: 271.5, cy: 1351.5, fontSize: 30.0005, baseFontSize: 23.978, sx: 1.251168049794, sy: 1.251168049794, tx: 240.318999283921, ty: 1362.739470040524 },
      { rank: 16, kind: "name", x: 241, y: 1380, w: 61, h: 29, cx: 271.5, cy: 1394.5, fontSize: 30.0005, baseFontSize: 23.978, sx: 1.251168049794, sy: 1.251168049794, tx: 239.318999283921, ty: 1405.739470040524 },
      { rank: 17, kind: "name", x: 241, y: 1423, w: 61, h: 29, cx: 271.5, cy: 1437.5, fontSize: 30.0005, baseFontSize: 23.978, sx: 1.251168049794, sy: 1.251168049794, tx: 239.318999283921, ty: 1448.739470040524 },
      { rank: 18, kind: "name", x: 240, y: 1465, w: 61, h: 29, cx: 270.5, cy: 1479.5, fontSize: 30.0005, baseFontSize: 23.978, sx: 1.251168049794, sy: 1.251168049794, tx: 239.318999283921, ty: 1490.739470040524 },
      { rank: 19, kind: "name", x: 240, y: 1508, w: 61, h: 29, cx: 270.5, cy: 1522.5, fontSize: 30.0005, baseFontSize: 23.978, sx: 1.251168049794, sy: 1.251168049794, tx: 238.318999283921, ty: 1533.739470040524 },
      { rank: 20, kind: "name", x: 241, y: 1551, w: 61, h: 29, cx: 271.5, cy: 1565.5, fontSize: 30.0005, baseFontSize: 23.978, sx: 1.251168049794, sy: 1.251168049794, tx: 239.318999283921, ty: 1576.739470040524 },
      { rank: 21, kind: "name", x: 240, y: 1594, w: 62, h: 29, cx: 271, cy: 1608.5, fontSize: 30.0005, baseFontSize: 23.978, sx: 1.251168049794, sy: 1.251168049794, tx: 238.318999283921, ty: 1619.739470040524 },
      { rank: 22, kind: "name", x: 637, y: 861, w: 61, h: 29, cx: 667.5, cy: 875.5, fontSize: 30.0005, baseFontSize: 23.978, sx: 1.251168049794, sy: 1.251168049794, tx: 635.318999283921, ty: 886.739470040524 },
      { rank: 23, kind: "name", x: 637, y: 902, w: 61, h: 29, cx: 667.5, cy: 916.5, fontSize: 30.0005, baseFontSize: 23.978, sx: 1.251168049794, sy: 1.251168049794, tx: 635.318999283921, ty: 927.739470040524 },
      { rank: 24, kind: "name", x: 636, y: 943, w: 61, h: 29, cx: 666.5, cy: 957.5, fontSize: 30.0005, baseFontSize: 23.978, sx: 1.251168049794, sy: 1.251168049794, tx: 635.318999283921, ty: 968.739470040524 },
      { rank: 25, kind: "name", x: 637, y: 983, w: 62, h: 31, cx: 668, cy: 998.5, fontSize: 30.0005, baseFontSize: 23.978, sx: 1.251168049794, sy: 1.251168049794, tx: 635.318999283921, ty: 1009.739470040524 },
      { rank: 26, kind: "name", x: 637, y: 1026, w: 61, h: 29, cx: 667.5, cy: 1040.5, fontSize: 30.0005, baseFontSize: 23.978, sx: 1.251168049794, sy: 1.251168049794, tx: 635.318999283921, ty: 1051.739470040524 },
      { rank: 27, kind: "name", x: 636, y: 1063, w: 61, h: 29, cx: 666.5, cy: 1077.5, fontSize: 30.0005, baseFontSize: 23.978, sx: 1.251168049794, sy: 1.251168049794, tx: 635.318999283921, ty: 1088.739470040524 },
      { rank: 28, kind: "name", x: 636, y: 1103, w: 60, h: 29, cx: 666, cy: 1117.5, fontSize: 30.0005, baseFontSize: 23.978, sx: 1.251168049794, sy: 1.251168049794, tx: 634.318999283921, ty: 1128.739470040524 },
      { rank: 29, kind: "name", x: 636, y: 1143, w: 62, h: 29, cx: 667, cy: 1157.5, fontSize: 30.0005, baseFontSize: 23.978, sx: 1.251168049794, sy: 1.251168049794, tx: 635.318999283921, ty: 1168.739470040524 },
      { rank: 30, kind: "name", x: 636, y: 1188, w: 61, h: 29, cx: 666.5, cy: 1202.5, fontSize: 30.0005, baseFontSize: 23.978, sx: 1.251168049794, sy: 1.251168049794, tx: 634.318999283921, ty: 1213.739470040524 },
      { rank: 31, kind: "name", x: 634, y: 1225, w: 63, h: 29, cx: 665.5, cy: 1239.5, fontSize: 30.0005, baseFontSize: 23.978, sx: 1.251168049794, sy: 1.251168049794, tx: 633.318999283921, ty: 1250.739470040524 },
      { rank: 32, kind: "name", x: 635, y: 1267, w: 62, h: 29, cx: 666, cy: 1281.5, fontSize: 30.0005, baseFontSize: 23.978, sx: 1.251168049794, sy: 1.251168049794, tx: 633.318999283921, ty: 1292.739470040524 },
      { rank: 33, kind: "name", x: 636, y: 1309, w: 61, h: 29, cx: 666.5, cy: 1323.5, fontSize: 30.0005, baseFontSize: 23.978, sx: 1.251168049794, sy: 1.251168049794, tx: 634.318999283921, ty: 1334.739470040524 },
      { rank: 34, kind: "name", x: 635, y: 1349, w: 62, h: 29, cx: 666, cy: 1363.5, fontSize: 30.0005, baseFontSize: 23.978, sx: 1.251168049794, sy: 1.251168049794, tx: 633.318999283921, ty: 1374.739470040524 },
      { rank: 35, kind: "name", x: 635, y: 1389, w: 61, h: 29, cx: 665.5, cy: 1403.5, fontSize: 30.0005, baseFontSize: 23.978, sx: 1.251168049794, sy: 1.251168049794, tx: 633.318999283921, ty: 1414.739470040524 },
      { rank: 36, kind: "name", x: 636, y: 1430, w: 60, h: 29, cx: 666, cy: 1444.5, fontSize: 30.0005, baseFontSize: 23.978, sx: 1.251168049794, sy: 1.251168049794, tx: 634.318999283921, ty: 1455.739470040524 },
      { rank: 37, kind: "name", x: 635, y: 1470, w: 61, h: 29, cx: 665.5, cy: 1484.5, fontSize: 30.0005, baseFontSize: 23.978, sx: 1.251168049794, sy: 1.251168049794, tx: 633.318999283921, ty: 1495.739470040524 },
      { rank: 38, kind: "name", x: 635, y: 1509, w: 60, h: 30, cx: 665, cy: 1524, fontSize: 30.0005, baseFontSize: 23.978, sx: 1.251168049794, sy: 1.251168049794, tx: 633.318999283921, ty: 1535.739470040524 },
      { rank: 39, kind: "name", x: 634, y: 1552, w: 61, h: 29, cx: 664.5, cy: 1566.5, fontSize: 30.0005, baseFontSize: 23.978, sx: 1.251168049794, sy: 1.251168049794, tx: 632.318999283921, ty: 1577.739470040524 },
      { rank: 40, kind: "name", x: 634, y: 1592, w: 61, h: 29, cx: 664.5, cy: 1606.5, fontSize: 30.0005, baseFontSize: 23.978, sx: 1.251168049794, sy: 1.251168049794, tx: 632.318999283921, ty: 1617.739470040524 },
    ],
    avatarSlots: [
      // PSD smartobject 位：按中心 x 映射 Top2 / Top1 / Top3
      { rank: 1, x: 334, y: 528, w: 304, h: 253 },
      { rank: 2, x: 71, y: 586, w: 202, h: 304 },
      { rank: 3, x: 633, y: 570, w: 204, h: 306 },
    ],
  },
  {
    id: "male-41-90",
    label: "男团 41-90",
    width: 926,
    height: 1698,
    image: "posters/male-41-90.png",
    rankStart: 41,
    rankEnd: 90,
    slots: [
      { rank: 41, kind: "name", x: 269, y: 541, w: 61, h: 30, cx: 299.5, cy: 556, fontSize: 30.0005, baseFontSize: 23.978, sx: 1.251168049794, sy: 1.251168049794, tx: 267.318999283921, ty: 567.739470040524 },
      { rank: 42, kind: "name", x: 268, y: 584, w: 61, h: 30, cx: 298.5, cy: 599, fontSize: 30.0005, baseFontSize: 23.978, sx: 1.251168049794, sy: 1.251168049794, tx: 266.318999283921, ty: 610.739470040524 },
      { rank: 43, kind: "name", x: 269, y: 630, w: 60, h: 30, cx: 299, cy: 645, fontSize: 30.0005, baseFontSize: 23.978, sx: 1.251168049794, sy: 1.251168049794, tx: 267.318999283921, ty: 656.739470040524 },
      { rank: 44, kind: "name", x: 269, y: 676, w: 61, h: 29, cx: 299.5, cy: 690.5, fontSize: 30.0005, baseFontSize: 23.978, sx: 1.251168049794, sy: 1.251168049794, tx: 267.318999283921, ty: 701.739470040524 },
      { rank: 45, kind: "name", x: 269, y: 721, w: 61, h: 29, cx: 299.5, cy: 735.5, fontSize: 30.0005, baseFontSize: 23.978, sx: 1.251168049794, sy: 1.251168049794, tx: 267.318999283921, ty: 746.739470040524 },
      { rank: 46, kind: "name", x: 269, y: 766, w: 61, h: 29, cx: 299.5, cy: 780.5, fontSize: 30.0005, baseFontSize: 23.978, sx: 1.251168049794, sy: 1.251168049794, tx: 267.318999283921, ty: 791.739470040524 },
      { rank: 47, kind: "name", x: 269, y: 810, w: 61, h: 30, cx: 299.5, cy: 825, fontSize: 30.0005, baseFontSize: 23.978, sx: 1.251168049794, sy: 1.251168049794, tx: 267.318999283921, ty: 836.739470040524 },
      { rank: 48, kind: "name", x: 269, y: 856, w: 61, h: 29, cx: 299.5, cy: 870.5, fontSize: 30.0005, baseFontSize: 23.978, sx: 1.251168049794, sy: 1.251168049794, tx: 267.318999283921, ty: 881.739470040524 },
      { rank: 49, kind: "name", x: 270, y: 901, w: 59, h: 29, cx: 299.5, cy: 915.5, fontSize: 30.0005, baseFontSize: 23.978, sx: 1.251168049794, sy: 1.251168049794, tx: 268.318999283921, ty: 926.739470040524 },
      { rank: 50, kind: "name", x: 270, y: 946, w: 60, h: 29, cx: 300, cy: 960.5, fontSize: 30.0005, baseFontSize: 23.978, sx: 1.251168049794, sy: 1.251168049794, tx: 268.318999283921, ty: 971.739470040524 },
      { rank: 51, kind: "name", x: 270, y: 991, w: 61, h: 29, cx: 300.5, cy: 1005.5, fontSize: 30.0005, baseFontSize: 23.978, sx: 1.251168049794, sy: 1.251168049794, tx: 268.318999283921, ty: 1016.739470040524 },
      { rank: 52, kind: "name", x: 270, y: 1035, w: 61, h: 30, cx: 300.5, cy: 1050, fontSize: 30.0005, baseFontSize: 23.978, sx: 1.251168049794, sy: 1.251168049794, tx: 268.318999283921, ty: 1061.739470040524 },
      { rank: 53, kind: "name", x: 268, y: 1079, w: 63, h: 29, cx: 299.5, cy: 1093.5, fontSize: 30.0005, baseFontSize: 23.978, sx: 1.251168049794, sy: 1.251168049794, tx: 267.318999283921, ty: 1104.739470040524 },
      { rank: 54, kind: "name", x: 269, y: 1125, w: 61, h: 29, cx: 299.5, cy: 1139.5, fontSize: 30.0005, baseFontSize: 23.978, sx: 1.251168049794, sy: 1.251168049794, tx: 267.318999283921, ty: 1150.739470040524 },
      { rank: 55, kind: "name", x: 270, y: 1170, w: 61, h: 29, cx: 300.5, cy: 1184.5, fontSize: 30.0005, baseFontSize: 23.978, sx: 1.251168049794, sy: 1.251168049794, tx: 268.318999283921, ty: 1195.739470040524 },
      { rank: 56, kind: "name", x: 270, y: 1215, w: 59, h: 29, cx: 299.5, cy: 1229.5, fontSize: 30.0005, baseFontSize: 23.978, sx: 1.251168049794, sy: 1.251168049794, tx: 268.318999283921, ty: 1240.739470040524 },
      { rank: 57, kind: "name", x: 270, y: 1260, w: 60, h: 29, cx: 300, cy: 1274.5, fontSize: 30.0005, baseFontSize: 23.978, sx: 1.251168049794, sy: 1.251168049794, tx: 268.318999283921, ty: 1285.739470040524 },
      { rank: 58, kind: "name", x: 270, y: 1305, w: 60, h: 29, cx: 300, cy: 1319.5, fontSize: 30.0005, baseFontSize: 23.978, sx: 1.251168049794, sy: 1.251168049794, tx: 268.318999283921, ty: 1330.739470040524 },
      { rank: 59, kind: "name", x: 270, y: 1350, w: 61, h: 29, cx: 300.5, cy: 1364.5, fontSize: 30.0005, baseFontSize: 23.978, sx: 1.251168049794, sy: 1.251168049794, tx: 268.318999283921, ty: 1375.739470040524 },
      { rank: 60, kind: "name", x: 270, y: 1395, w: 60, h: 29, cx: 300, cy: 1409.5, fontSize: 30.0005, baseFontSize: 23.978, sx: 1.251168049794, sy: 1.251168049794, tx: 268.318999283921, ty: 1420.739470040524 },
      { rank: 61, kind: "name", x: 270, y: 1439, w: 59, h: 30, cx: 299.5, cy: 1454, fontSize: 30.0005, baseFontSize: 23.978, sx: 1.251168049794, sy: 1.251168049794, tx: 268.318999283921, ty: 1465.739470040524 },
      { rank: 62, kind: "name", x: 270, y: 1485, w: 62, h: 29, cx: 301, cy: 1499.5, fontSize: 30.0005, baseFontSize: 23.978, sx: 1.251168049794, sy: 1.251168049794, tx: 268.318999283921, ty: 1510.739470040524 },
      { rank: 63, kind: "name", x: 270, y: 1531, w: 60, h: 29, cx: 300, cy: 1545.5, fontSize: 30.0005, baseFontSize: 23.978, sx: 1.251168049794, sy: 1.251168049794, tx: 268.318999283921, ty: 1556.739470040524 },
      { rank: 64, kind: "name", x: 270, y: 1576, w: 61, h: 29, cx: 300.5, cy: 1590.5, fontSize: 30.0005, baseFontSize: 23.978, sx: 1.251168049794, sy: 1.251168049794, tx: 268.318999283921, ty: 1601.739470040524 },
      { rank: 65, kind: "name", x: 270, y: 1620, w: 62, h: 30, cx: 301, cy: 1635, fontSize: 30.0005, baseFontSize: 23.978, sx: 1.251168049794, sy: 1.251168049794, tx: 268.318999283921, ty: 1646.739470040524 },
      { rank: 66, kind: "name", x: 653, y: 539, w: 61, h: 29, cx: 683.5, cy: 553.5, fontSize: 30.0005, baseFontSize: 23.978, sx: 1.251168049794, sy: 1.251168049794, tx: 651.318999283921, ty: 564.739470040524 },
      { rank: 67, kind: "name", x: 652, y: 581, w: 61, h: 30, cx: 682.5, cy: 596, fontSize: 30.0005, baseFontSize: 23.978, sx: 1.251168049794, sy: 1.251168049794, tx: 650.318999283921, ty: 607.739470040524 },
      { rank: 68, kind: "name", x: 649, y: 623, w: 57, h: 36, cx: 677.5, cy: 641, fontSize: 30.0005, baseFontSize: 23.978, sx: 1.251168049794, sy: 1.251168049794, tx: 651.318999283921, ty: 653.739470040524 },
      { rank: 69, kind: "name", x: 649, y: 668, w: 57, h: 36, cx: 677.5, cy: 686, fontSize: 30.0005, baseFontSize: 23.978, sx: 1.251168049794, sy: 1.251168049794, tx: 651.318999283921, ty: 698.739470040524 },
      { rank: 70, kind: "name", x: 649, y: 713, w: 57, h: 36, cx: 677.5, cy: 731, fontSize: 30.0005, baseFontSize: 23.978, sx: 1.251168049794, sy: 1.251168049794, tx: 651.318999283921, ty: 743.739470040524 },
      { rank: 71, kind: "name", x: 649, y: 758, w: 57, h: 36, cx: 677.5, cy: 776, fontSize: 30.0005, baseFontSize: 23.978, sx: 1.251168049794, sy: 1.251168049794, tx: 651.318999283921, ty: 788.739470040524 },
      { rank: 72, kind: "name", x: 649, y: 803, w: 57, h: 36, cx: 677.5, cy: 821, fontSize: 30.0005, baseFontSize: 23.978, sx: 1.251168049794, sy: 1.251168049794, tx: 651.318999283921, ty: 833.739470040524 },
      { rank: 73, kind: "name", x: 649, y: 848, w: 57, h: 36, cx: 677.5, cy: 866, fontSize: 30.0005, baseFontSize: 23.978, sx: 1.251168049794, sy: 1.251168049794, tx: 651.318999283921, ty: 878.739470040524 },
      { rank: 74, kind: "name", x: 650, y: 893, w: 57, h: 36, cx: 678.5, cy: 911, fontSize: 30.0005, baseFontSize: 23.978, sx: 1.251168049794, sy: 1.251168049794, tx: 652.318999283921, ty: 923.739470040524 },
      { rank: 75, kind: "name", x: 650, y: 938, w: 57, h: 36, cx: 678.5, cy: 956, fontSize: 30.0005, baseFontSize: 23.978, sx: 1.251168049794, sy: 1.251168049794, tx: 652.318999283921, ty: 968.739470040524 },
      { rank: 76, kind: "name", x: 650, y: 983, w: 57, h: 36, cx: 678.5, cy: 1001, fontSize: 30.0005, baseFontSize: 23.978, sx: 1.251168049794, sy: 1.251168049794, tx: 652.318999283921, ty: 1013.739470040524 },
      { rank: 77, kind: "name", x: 650, y: 1028, w: 57, h: 36, cx: 678.5, cy: 1046, fontSize: 30.0005, baseFontSize: 23.978, sx: 1.251168049794, sy: 1.251168049794, tx: 652.318999283921, ty: 1058.739470040524 },
      { rank: 78, kind: "name", x: 649, y: 1075, w: 57, h: 36, cx: 677.5, cy: 1093, fontSize: 30.0005, baseFontSize: 23.978, sx: 1.251168049794, sy: 1.251168049794, tx: 651.318999283921, ty: 1105.739470040524 },
      { rank: 79, kind: "name", x: 650, y: 1120, w: 57, h: 36, cx: 678.5, cy: 1138, fontSize: 30.0005, baseFontSize: 23.978, sx: 1.251168049794, sy: 1.251168049794, tx: 652.318999283921, ty: 1150.739470040524 },
      { rank: 80, kind: "name", x: 650, y: 1164, w: 57, h: 36, cx: 678.5, cy: 1182, fontSize: 30.0005, baseFontSize: 23.978, sx: 1.251168049794, sy: 1.251168049794, tx: 652.318999283921, ty: 1194.739470040524 },
      { rank: 81, kind: "name", x: 650, y: 1210, w: 57, h: 36, cx: 678.5, cy: 1228, fontSize: 30.0005, baseFontSize: 23.978, sx: 1.251168049794, sy: 1.251168049794, tx: 652.318999283921, ty: 1240.739470040524 },
      { rank: 82, kind: "name", x: 651, y: 1255, w: 57, h: 36, cx: 679.5, cy: 1273, fontSize: 30.0005, baseFontSize: 23.978, sx: 1.251168049794, sy: 1.251168049794, tx: 653.318999283921, ty: 1285.739470040524 },
      { rank: 83, kind: "name", x: 650, y: 1297, w: 57, h: 36, cx: 678.5, cy: 1315, fontSize: 30.0005, baseFontSize: 23.978, sx: 1.251168049794, sy: 1.251168049794, tx: 652.318999283921, ty: 1327.739470040524 },
      { rank: 84, kind: "name", x: 650, y: 1344, w: 57, h: 36, cx: 678.5, cy: 1362, fontSize: 30.0005, baseFontSize: 23.978, sx: 1.251168049794, sy: 1.251168049794, tx: 652.318999283921, ty: 1374.739470040524 },
      { rank: 85, kind: "name", x: 650, y: 1387, w: 57, h: 36, cx: 678.5, cy: 1405, fontSize: 30.0005, baseFontSize: 23.978, sx: 1.251168049794, sy: 1.251168049794, tx: 652.318999283921, ty: 1417.739470040524 },
      { rank: 86, kind: "name", x: 650, y: 1435, w: 57, h: 36, cx: 678.5, cy: 1453, fontSize: 30.0005, baseFontSize: 23.978, sx: 1.251168049794, sy: 1.251168049794, tx: 652.318999283921, ty: 1465.739470040524 },
      { rank: 87, kind: "name", x: 650, y: 1477, w: 57, h: 36, cx: 678.5, cy: 1495, fontSize: 30.0005, baseFontSize: 23.978, sx: 1.251168049794, sy: 1.251168049794, tx: 652.318999283921, ty: 1507.739470040524 },
      { rank: 88, kind: "name", x: 650, y: 1523, w: 57, h: 36, cx: 678.5, cy: 1541, fontSize: 30.0005, baseFontSize: 23.978, sx: 1.251168049794, sy: 1.251168049794, tx: 652.318999283921, ty: 1553.739470040524 },
      { rank: 89, kind: "name", x: 650, y: 1568, w: 57, h: 36, cx: 678.5, cy: 1586, fontSize: 30.0005, baseFontSize: 23.978, sx: 1.251168049794, sy: 1.251168049794, tx: 652.318999283921, ty: 1598.739470040524 },
      { rank: 90, kind: "name", x: 650, y: 1613, w: 57, h: 36, cx: 678.5, cy: 1631, fontSize: 30.0005, baseFontSize: 23.978, sx: 1.251168049794, sy: 1.251168049794, tx: 652.318999283921, ty: 1643.739470040524 },
    ],
  },
];
