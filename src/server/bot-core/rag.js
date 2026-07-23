import { createRequire } from "module";

const require = createRequire(import.meta.url);
const rag = require("../../../electron/weixin-bot-rag.js");

export const loadRagDocuments = rag.loadRagDocuments;
export const ragSearch = rag.ragSearch;
export const looksLikeStructuredDataQuestion = rag.looksLikeStructuredDataQuestion;

export default rag;
