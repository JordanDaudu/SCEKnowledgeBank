/**
 * Reputation scoring config — pure, no DB. Weights, level thresholds, and the
 * badge catalog all read a single `ReputationStats` shape that the repo
 * computes from current state. Tune weights/thresholds here; nothing else
 * changes. Mirrors the weight-config style of `lib/ranking.ts`.
 */

export interface ReputationStats {
  /** Alive & published documents you uploaded. */
  publishedUploads: number;
  /** Downloads of your docs by other users (self-downloads excluded). */
  downloadsReceived: number;
  /** Favorites on your docs (self-favorites excluded at source). */
  favoritesReceived: number;
  /** Your public/official, non-hidden collections. */
  publicCollections: number;
  /** Followers across your collections. */
  followersReceived: number;
  /** Your alive comments. */
  comments: number;
  /** Reactions others left on your comments (self excluded). */
  reactionsReceived: number;
  /** Your alive material requests. */
  requests: number;
}

export const WEIGHTS = {
  publishedUploads: 10,
  downloadsReceived: 2,
  favoritesReceived: 3,
  publicCollections: 5,
  followersReceived: 2,
  comments: 2,
  reactionsReceived: 1,
  requests: 1,
} as const satisfies Record<keyof ReputationStats, number>;

export function scoreFromStats(s: ReputationStats): number {
  return (Object.keys(WEIGHTS) as (keyof ReputationStats)[]).reduce(
    (sum, k) => sum + s[k] * WEIGHTS[k],
    0,
  );
}

export interface Level {
  key: "novice" | "contributor" | "scholar" | "sage";
  label: string;
  minScore: number;
}

/** Ordered low→high. `levelForScore` returns the highest whose `minScore <= score`. */
export const LEVELS: Level[] = [
  { key: "novice", label: "Novice", minScore: 0 },
  { key: "contributor", label: "Contributor", minScore: 50 },
  { key: "scholar", label: "Scholar", minScore: 250 },
  { key: "sage", label: "Sage", minScore: 1000 },
];

export function levelForScore(score: number): Level {
  let current = LEVELS[0];
  for (const l of LEVELS) if (score >= l.minScore) current = l;
  return current;
}

export interface BadgeDef {
  key: string;
  name: string;
  description: string;
  /** lucide-react icon name, consumed by the web layer. */
  icon: string;
  earned: (s: ReputationStats) => boolean;
}

export const BADGES: BadgeDef[] = [
  { key: "first_upload", name: "First Upload", description: "Shared your first document.", icon: "Upload", earned: (s) => s.publishedUploads >= 1 },
  { key: "prolific", name: "Prolific", description: "Uploaded 10 documents.", icon: "Files", earned: (s) => s.publishedUploads >= 10 },
  { key: "librarian", name: "Librarian", description: "Uploaded 50 documents.", icon: "Library", earned: (s) => s.publishedUploads >= 50 },
  { key: "popular", name: "Popular", description: "Your documents were downloaded 100 times.", icon: "Download", earned: (s) => s.downloadsReceived >= 100 },
  { key: "crowd_favorite", name: "Crowd Favorite", description: "Earned 50 favorites.", icon: "Star", earned: (s) => s.favoritesReceived >= 50 },
  { key: "trusted", name: "Trusted", description: "Reached Scholar level.", icon: "ShieldCheck", earned: (s) => scoreFromStats(s) >= 250 },
  { key: "conversationalist", name: "Conversationalist", description: "Posted 10 comments.", icon: "MessageSquare", earned: (s) => s.comments >= 10 },
  { key: "helpful", name: "Helpful", description: "Got 25 reactions on your comments.", icon: "ThumbsUp", earned: (s) => s.reactionsReceived >= 25 },
  { key: "curator", name: "Curator", description: "Created 3 public collections.", icon: "FolderHeart", earned: (s) => s.publicCollections >= 3 },
];

export function earnedBadgeKeys(s: ReputationStats): string[] {
  return BADGES.filter((b) => b.earned(s)).map((b) => b.key);
}
