// exceljs 只提供 CommonJS 类型；这里按浏览器 dist 包动态引入，补一条声明避免出现隐式 any。
declare module "exceljs/dist/exceljs.min.js";
