# git-dojo

給 Git 新手的團隊協作練習場：在瀏覽器裡跟一個「模擬的 AI」一起，用真的 git 狀態機走完開分支、commit、push、開 PR、解衝突、審查、合併、上線。全部在瀏覽器內執行，沒有後端、沒有帳號、不呼叫任何 API。

- 線上版：https://lucaslee0327.github.io/git-dojo/
- 介面是繁體中文；git 輸出保留英文原文，下面附中文解說。僅支援電腦版瀏覽器（寬度小於 900px 會請你改用電腦）。
- 教材是虛構的專案「小共筆 TinyNote」，人物（小美、部長）都是機器人。

## 內容

| 部 | 關卡 | 主題 |
| --- | --- | --- |
| 1 | 0–4 | 手打 git：認識畫面、一個人做功能（分支、commit、PR）、衝突、push 被拒絕、在 staging 上 commit 了 |
| 2 | 5–7 | 指揮 AI（模擬 Auto 模式）：開工提示、權限規則、Esc 打斷、看不出來的衝突 |
| 3 | 8–10（部長必修、部員選修） | 審小美的 PR、測試站壞了（revert 而不是 force push）、上線 |
| ★ | 自由模式 | 隨便玩，不會過關 |

畫面：左邊是模擬的 AI 與終端機；中間是預覽站／GitHub／編輯器；右邊是常駐的 Git 狀態面板（狀態摘要＋動畫分支圖，可切換「你的電腦／GitHub 實際狀態／小美的電腦」）。判定看最後的 git 狀態，任何合法做法都算過關；走錯路時有「時光倒流」。

進度存在瀏覽器的 localStorage。無痕視窗、清除網站資料、換電腦或換瀏覽器都會讓進度消失；localStorage 不能用時網站仍可玩，只是不會保存。

## 開發

```bash
npm ci
npm run dev        # http://localhost:5173/git-dojo/
npm test           # vitest：git 引擎、每一關的通關路徑與陷阱、分支圖版面不重疊、存檔層
npm run build      # tsc --noEmit && vite build（輸出到 dist/，base 為 /git-dojo/）
npm run docs:levels  # 由關卡定義重新產生 docs/design/04-關卡劇本.md
```

技術：Vite、TypeScript（strict）、Preact、Vitest。結構與設計取捨見 `CLAUDE.md` 和 `docs/design/`。

## 部署

推到 `main` 會由 `.github/workflows/deploy.yml` 跑測試、建置並發佈到 GitHub Pages（需在 repo 設定的 Pages 選 "GitHub Actions" 作為來源）。
