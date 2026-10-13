# git-dojo — 瀏覽器內的 Git 團隊協作練習場

模擬 AI 助手＋git 狀態機＋假 GitHub＋即時預覽的小專案，部署在 GitHub Pages。
設計書（唯一真相來源，含決策日誌）：`docs/design/README.md`。

## Session 開始時必做

1. 讀 `docs/design/README.md`（導覽＋決策日誌），需要細節再讀子頁。

## 開發規則（使用者訂立，務必遵守）

- **本 repo 公開，內容一律去識別化**：不寫真實組織名、真實 repo 名、內部路徑或人名。
- AI 助手是模擬的，**不連任何 API**；所有回應預先寫在程式裡。
- 提案（比使用者原需求更好的替代方案）要等使用者確認才能動工。
- 問使用者問題：純文字條列＋選項（A/B/C），不用 AskUserQuestion。
- 只把明確討論過並確認的內容寫進設計書；決議確認當下就寫入（絕對日期）。
- 每次寫完程式都要 build 通過，並實際在瀏覽器操作，確認沒有 runtime error，才算完成。
- 建 GitHub repo、push、開 Pages 這類對外動作，先問使用者。
- 本 repo 的規則檔（本檔等）由使用者授權 Claude Code 撰寫（2026-10-14）。

## 技術棧與限制

- Vite＋TypeScript，靜態網站；GitHub Actions 部署到 Pages。
- 本機 Node 22（v22.23.1）、Windows 11；使用者 shell 為 PowerShell 5.1。寫檔要用無 BOM 的 UTF-8。
- 只支援電腦版瀏覽器；進度存在 localStorage。
