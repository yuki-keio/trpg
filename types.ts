
export interface Weapon {
  id: string;
  name: string;
  damage: string; // e.g., '1d10', '1d3+db'
  range: string; // e.g., 'タッチ', '20m'
  attacksPerRound: number;
  ammoCapacity: number | null; // For firearms
  currentAmmo: number | null;
  durability: number | null; // 耐久力
  malfunction: number | null; // e.g., 99 for 99-100
  notes: string;
}

export interface Armor {
  id: string;
  name: string;
  armorValue: number;
  notes: string;
}


export interface CustomSkill {
  id: string;
  name: string;
  baseValue: number;
  category: string;
}

export interface Character {
  id: string;
  name: string;
  occupation: string;
  description: string;
  iconUrl?: string;
  stats: {
    STR: number; // 筋力
    CON: number; // 体力
    POW: number; // 精神力
    DEX: number; // 敏捷性
    APP: number; // 外見
    SIZ: number; // 体格
    INT: number; // 知性
    EDU: number; // 教育
  };
  // 成長分を追加
  statGrowth?: {
    STR?: number;
    CON?: number;
    POW?: number;
    DEX?: number;
    APP?: number;
    SIZ?: number;
    INT?: number;
    EDU?: number;
  };
  hp: { current: number; max: number; growth?: number };
  mp: { current: number; max: number; growth?: number };
  san: { current: number; max: number; growth?: number };
  skills: { [key: string]: number };
  skillGrowth?: { [key: string]: number }; // 技能成長分
  customOccupationalSkills?: string[];
  customSkills?: CustomSkill[]; // 独自技能
  weapons: Weapon[];
  armor: Armor[];
  madness?: {
    type: 'temporary' | 'indefinite' | null;
    description: string;
    duration?: number; // ラウンド数（一時的狂気の場合）
  };
}

export enum MessageSender {
  Player = 'PLAYER',
  Keeper = 'KEEPER',
  System = 'SYSTEM',
}

export interface Message {
  id: string;
  sender: MessageSender;
  content: string;
}

export interface ScenarioOutline {
  title: string;
  summary: string;
  clearCondition: string;
  failureCondition: string;
  truth: string; // 真相
  estimatedPlayTime: string;
}

export enum GameState {
  CharacterCreation,
  GeneratingScenario,
  Playing,
  GameOver,
  GameClear,
}

export interface Reward {
  name: string;
  effect: string;
}

export interface KeeperResponse {
  description: string;
  actionRequired: string;
  sanityCheck: { roll: string; reason: string; targetAll?: boolean } | null;
  skillCheck: string | null;
  statCheck: { stat: keyof Character['stats']; multiplier?: number; reason: string } | null;
  diceRollRequired: { roll: string; reason: string } | null;
  madnessRecovery: { characterId: string; reason: string; type: 'temporary' | 'indefinite' | 'both' } | null;
  suggestedActions: string[] | null;
  gameOver: boolean;
  gameClear: boolean;
  rewards: Reward[] | null;
}
