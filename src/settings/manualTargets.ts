/**
 * マウス操作モード（manual）の「操作するもの」候補（純データ＋純ロジック。DOM/PixiJS 非依存＝Vitest 可能）。
 *
 * [UR-4] manual は従来ネズミ 1 体固定だったが、操作対象を選べる基盤に一般化した。この一覧が
 * 「セレクタに並ぶ候補」かつ「永続値 normalize の許可集合」の単一の真実源になる（SPAWN_PRESETS と同流儀）。
 * 種別 id は各 CritterType 定義の定数を import して使う（文字列直書きせず、タイポ/将来の id 変更に強くする）。
 *
 * UR-5（ねこじゃらしのフリック）/ UR-6（虫のクリック出現）は「固有 manual 挙動」を別途差し込むが、
 * 候補としての在否・順序・表示名はここで一元管理する。
 */

import { FOXTAIL_TYPE_ID } from "../critters/types/foxtail";
import { CUSTOM_CRITTER_TYPE_ID } from "../critters/types/imageCritter";
import { INSECT_TYPE_ID } from "../critters/types/insect";
import { MOUSE_TYPE_ID } from "../critters/types/mouse";
import { TOYS_TYPE_ID } from "../critters/types/toys";

/** 操作対象 1 件。id で引き、label を UI（セレクタ）表示に使う。 */
export interface ManualTarget {
  /** レジストリ登録済みの種別 id（manual コントローラの factory マップのキーにも一致させる）。 */
  id: string;
  /** UI 表示名。 */
  label: string;
}

/**
 * 選択可能な操作対象一覧（セレクタに並べる順）。
 * mouse=ネズミ / foxtail=ねこじゃらし / toys=おもちゃ / insect=虫 / custom=任意画像。
 * 固有挙動は各コントローラが担う（foxtail=画面端フリック / insect=クリック出現 or 追従 / custom=画像追従）。
 *
 * [UR3-10] custom（任意画像）は **マウス操作モード専用**（動画モードには出さない）。ここに候補として
 * 常在させることで「操作するもの」で選択でき、選んだときだけ OptionsPanel が画像設定 UI を出す。
 * 画像未ロード時は critter を出さない inert コントローラで待機し、画像ロードで追従を開始する。
 */
export const MANUAL_TARGETS: readonly ManualTarget[] = [
  { id: MOUSE_TYPE_ID, label: "ネズミ" },
  { id: FOXTAIL_TYPE_ID, label: "ねこじゃらし" },
  { id: TOYS_TYPE_ID, label: "おもちゃ" },
  { id: INSECT_TYPE_ID, label: "虫" },
  { id: CUSTOM_CRITTER_TYPE_ID, label: "任意画像" },
];

/** 既定の操作対象 id（ネズミ）。従来のマウス操作＝ネズミ追従を初期値として保つ。 */
export const DEFAULT_MANUAL_TYPE_ID: string = MOUSE_TYPE_ID;

/** 指定 id が選択可能な操作対象なら true。 */
export function isManualTarget(id: string): boolean {
  return MANUAL_TARGETS.some((target) => target.id === id);
}

/**
 * 操作対象 id を正規化する。選択可能な id のいずれかならその値、でなければ既定（mouse）へ落とす。
 * 永続値・外部入力の堅牢化に使う純ロジック（settingsData / SettingsStore が共有する）。
 */
export function normalizeManualTypeId(value: unknown): string {
  return typeof value === "string" && isManualTarget(value) ? value : DEFAULT_MANUAL_TYPE_ID;
}
