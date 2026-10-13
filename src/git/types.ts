// 純資料、可序列化的 git 子集型別

export type Files = Record<string, string>;
export type RepoName = 'me' | 'mei' | 'origin';
export type Actor = 'me' | 'mei' | 'boss';

export interface Commit {
  id: string;
  parents: string[];
  message: string;
  author: Actor;
  time: number;
  tree: Files;
  /** 內容來源（squash 合併用灰色虛線標示） */
  squashOf?: string[];
  /** 這個 commit 是 GitHub 網頁操作產生的（Update branch / Revert / Squash） */
  viaWeb?: boolean;
}

export type Head = { kind: 'branch'; name: string } | { kind: 'detached'; id: string };

export interface ReflogEntry {
  ref: string; // 'HEAD' 或分支名
  from: string | null;
  to: string;
  msg: string;
}

export interface MergeState {
  other: string; // MERGE_HEAD
  otherName: string;
  message: string;
  conflicts: string[];
}

export interface Repo {
  name: RepoName;
  bare: boolean;
  head: Head;
  branches: Record<string, string>;
  /** 遠端追蹤分支，例如 'origin/staging' → commit id（上次 fetch 時的狀態） */
  remotes: Record<string, string>;
  index: Files;
  work: Files;
  tracking: Record<string, { remote: string; branch: string }>;
  config: { pullRebase: boolean | null; fetchPrune?: boolean; userName: string; userEmail: string };
  reflog: ReflogEntry[];
  merge: MergeState | null;
  stash: { message: string; index: Files; work: Files; base: string }[];
  hooks: { preCommit: boolean };
  /** 對衝突檔案：還沒 add 的檔案清單的 stage 資訊（ours/theirs 版本） */
  conflictBlobs: Record<string, { ours: string | null; theirs: string | null; base: string | null }>;
}

export interface World {
  clock: number;
  objects: Record<string, Commit>;
  repos: Record<RepoName, Repo>;
  github: GitHubState;
}

// ---------- GitHub ----------
export interface Review {
  by: Actor;
  state: 'approved' | 'changes_requested' | 'commented';
  body: string;
  todos: string[];
  headAtReview: string;
}

export interface PRComment {
  by: Actor;
  body: string;
}

export interface PR {
  number: number;
  title: string;
  body: string;
  author: Actor;
  head: string;
  base: string;
  draft: boolean;
  state: 'open' | 'merged' | 'closed';
  reviews: Review[];
  comments: PRComment[];
  mergeMethod?: 'squash' | 'merge';
  mergeSha?: string;
  mergedBy?: Actor;
  headDeleted: boolean;
  revertOf?: number;
  wasDraft: boolean;
  events: string[];
  /** 合併時記下 head / base 的 commit，合併後仍可顯示 Files changed */
  finalHead?: string;
  finalBase?: string;
}

export interface Issue {
  number: number;
  title: string;
  body: string;
}

export interface Alert {
  id: string;
  text: string;
}

export interface GitHubState {
  repoName: string;
  prs: PR[];
  nextNumber: number;
  issues: Issue[];
  alerts: Alert[];
}

// ---------- 指令結果 ----------
export interface CmdResult {
  out: string;
  code: number;
  explain?: string;
  /** 指令類別（給機器人／判定用） */
  tag?: string;
}
