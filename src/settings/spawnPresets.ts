/**
 * 出現プリセット（賑やか/標準/控えめ）。auto（動画モード）の「出現間隔」と「出現する種類」を
 * ワンタップで束ねて切り替えるための純データ＋純ロジック（DOM/PixiJS 非依存 = Vitest で単体テスト可能）。
 *
 * プリセットは既存の autoSpawnIntervalMs / autoDisabledTypes を 1 操作で設定する
 * （SettingsStore.applySpawnPreset が commit 1 回で反映し、既存の永続化・購読経路にそのまま乗る）。
 * 種別 id は各 CritterType 定義の定数を import して使う（文字列直書きをせず、タイポ/将来の id 変更に強くする）。
 */

import { INSECT_TYPE_ID } from "../critters/types/insect";

/** 出現プリセット 1 件。id で引き、label を UI 表示、intervalMs/disabledTypes を一括適用する。 */
export interface SpawnPreset {
  /** 一意なプリセット id（UI が適用時に使う。永続化はしない＝適用結果の設定値のみ保存される）。 */
  id: string;
  /** UI 表示名。 */
  label: string;
  /** auto 出現間隔(ms)。MIN/MAX_AUTO_SPAWN_INTERVAL_MS の範囲内で定義する。 */
  intervalMs: number;
  /** 出現を無効化する組み込み種別 id の配列（[]＝全種別有効）。 */
  disabledTypes: readonly string[];
}

/**
 * 出現プリセット一覧（UI に並べる順）。
 * - lively   : 高密度・全種で賑やかに（intervalMs=600）。
 * - standard : 既定相当（DEFAULT_AUTO_SPAWN_INTERVAL_MS と同値の 1500）・全種。
 * - calm     : ゆったり間隔（3500）。不規則ダッシュの虫(insect)を外して穏やかにする。
 * intervalMs は MIN/MAX_AUTO_SPAWN_INTERVAL_MS の範囲内（定義時点で満たす。spawnPresets.test.ts で検証）。
 */
export const SPAWN_PRESETS: readonly SpawnPreset[] = [
  { id: "lively", label: "賑やか", intervalMs: 600, disabledTypes: [] },
  { id: "standard", label: "標準", intervalMs: 1500, disabledTypes: [] },
  { id: "calm", label: "控えめ", intervalMs: 3500, disabledTypes: [INSECT_TYPE_ID] },
];

/** id からプリセットを引く（見つからなければ undefined）。UI が id で適用する用。 */
export function findSpawnPreset(id: string): SpawnPreset | undefined {
  return SPAWN_PRESETS.find((preset) => preset.id === id);
}
