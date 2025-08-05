
import { GoogleGenAI, Type, GenerateContentResponse, Chat } from "@google/genai";
import type { Character, KeeperResponse, ScenarioOutline } from "../types";
import { SYSTEM_INSTRUCTION } from "../constants";

if (!process.env.API_KEY) {
  throw new Error("API_KEY environment variable not set");
}

const ai = new GoogleGenAI({
  apiKey: process.env.API_KEY!
});
const modelConfig = {
  model: "gemini-2.5-flash",
  config: {
    // systemInstruction is now part of the chat initialization.
    responseMimeType: "application/json",
    responseSchema: {
      type: Type.OBJECT,
      properties: {
        description: { type: Type.STRING, description: "状況の描写、NPCのセリフ、イベントの説明など、物語の本文。Markdown形式で、太字や二連改行も用いて簡潔・魅力的に記述。" },
        actionRequired: { type: Type.STRING, description: "プレイヤーに次なる行動を促すための問いかけや選択肢。" },
        sanityCheck: {
          type: Type.OBJECT,
          nullable: true,
          properties: {
            roll: { type: Type.STRING, description: "SANチェックの減少量 (例: '1/1d6')" },
            reason: { type: Type.STRING, description: "SANチェックの理由" },
            targetAll: { type: Type.BOOLEAN, nullable: true, description: "全探索者がチェックを受ける場合はtrue、個別の場合はfalse（デフォルト）" }
          }
        },
        skillCheck: { type: Type.STRING, nullable: true, description: "判定が推奨される技能名。必ず単一の技能名のみ指定すること (例: '目星', '隠れる', '聞き耳'など)。複数の技能や複数の探索者の技能を同時に指定してはいけません。" },
        statCheck: {
          type: Type.OBJECT,
          nullable: true,
          properties: {
            stat: { type: Type.STRING, description: "判定が推奨される能力値名。必ず'STR', 'CON', 'POW', 'DEX', 'APP', 'SIZ', 'INT', 'EDU'のいずれかの文字列でなければならない。" },
            multiplier: { type: Type.INTEGER, nullable: true, description: "能力値に乗算する値。指定されない場合は5を使用します。" },
            reason: { type: Type.STRING, description: "能力値判定の理由" }
          }
        },
        diceRollRequired: {
          type: Type.OBJECT,
          nullable: true,
          properties: {
            roll: { type: Type.STRING, description: "要求するダイスロール (例: '1d6')" },
            reason: { type: Type.STRING, description: "ダイスロールの理由" }
          }
        },
        madnessRecovery: {
          type: Type.OBJECT,
          nullable: true,
          properties: {
            characterId: { type: Type.STRING, description: "回復する探索者のID" },
            reason: { type: Type.STRING, description: "狂気回復の理由" },
            type: { type: Type.STRING, description: "回復する狂気の種類: 'temporary'（一時的狂気）、'indefinite'（不定の狂気）、'both'（両方）" }
          }
        },
        suggestedActions: {
          type: Type.ARRAY,
          nullable: true,
          items: {
            type: Type.STRING,
            description: "プレイヤーへの行動の提案"
          }
        },
        gameOver: { type: Type.BOOLEAN, description: "ゲームが失敗条件を満たして終了したかどうか（例：全員の死亡・発狂）。" },
        gameClear: { type: Type.BOOLEAN, description: "ゲームがクリア条件を満たして正常に終了したかどうか。" },
        rewards: {
          type: Type.ARRAY,
          nullable: true,
          items: {
            type: Type.OBJECT,
            properties: {
              name: { type: Type.STRING, description: "報酬アイテムや情報の魅力的な名前。" },
              effect: { type: Type.STRING, description: "報酬アイテムや情報の具体的な効果、詳細な説明（武器なら射程・ダメージなど）。ゲームバランスの維持に配慮すること。" }
            },
            required: ["name", "effect"]
          },
          description: "ゲームクリア時に探索者が獲得した報酬のリスト。"
        }
      },
      required: ["description", "actionRequired", "gameOver", "gameClear"]
    }
  }
};

const { model, config } = modelConfig;

const parseResponse = (response: GenerateContentResponse): KeeperResponse => {
  try {
    const text = response.text?.trim() || '';
    // Potentially remove markdown backticks
    const cleanedText = text.replace(/^```json\s*|```$/g, '');
    console.log("Raw AI response:", cleanedText);
    const parsed = JSON.parse(cleanedText);
    return parsed as KeeperResponse;
  } catch (error) {
    console.error("Failed to parse AI response:", response.text, error);
    // Fallback response
    return {
      description: "エラーが発生しました。予期せぬ応答がAIから返されました。もう一度行動してみてください。",
      actionRequired: "あなたたちはどうしますか？",
      sanityCheck: null,
      skillCheck: null,
      statCheck: null,
      diceRollRequired: null,
      madnessRecovery: null,
      suggestedActions: ["あたりを見回す", "持ち物を確認する"],
      gameOver: false,
      gameClear: false,
      rewards: null,
    };
  }
}

const formatCharacterInfo = (character: Character) => {
  const weaponsInfo = character.weapons.length > 0
    ? character.weapons.map(w => `  - ${w.name} (ダメージ: ${w.damage}, ${w.ammoCapacity !== null ? `装弾数: ${w.currentAmmo}/${w.ammoCapacity}` : '近接/投擲'}, 備考: ${w.notes || 'なし'})`).join('\n')
    : '  なし';
  const armorInfo = character.armor.length > 0
    ? character.armor.map(a => `  - ${a.name} (装甲値: ${a.armorValue}, 備考: ${a.notes || 'なし'})`).join('\n')
    : '  なし';

  const madnessInfo = character.madness?.type
    ? `${character.madness.type === 'temporary' ? '一時的狂気' : '不定の狂気'}: ${character.madness.description}${character.madness.duration ? ` (残り${character.madness.duration}ラウンド)` : ''}`
    : 'なし';

  return `
- **ID**: ${character.id}
- **名前**: ${character.name}
- **職業**: ${character.occupation || '未設定'}
- **キャラクター設定**: ${character.description || '特になし'}
- **能力値**: ${JSON.stringify(character.stats)}
- **HP**: ${character.hp.current}/${character.hp.max}
- **正気度(SAN)**: ${character.san.current}/${character.san.max}
- **狂気状態**: ${madnessInfo}
- **技能**: ${JSON.stringify(character.skills)}
- **武器**:\n${weaponsInfo}
- **防具**:\n${armorInfo}
    `.trim();
}

export const createChatSession = (): Chat => {
  return ai.chats.create({
    model,
    config: {
      ...config,
      systemInstruction: SYSTEM_INSTRUCTION,
    },
  });
};

const scenarioOutlineSchema = {
  type: Type.OBJECT,
  properties: {
    title: { type: Type.STRING, description: "このシナリオの魅力的でミステリアスなタイトル。" },
    summary: { type: Type.STRING, description: "ゲームキーパーだけが知る、シナリオの内部的な要約。物語の背景、主要なNPC、舞台設定、予想される展開を含む。" },
    clearCondition: { type: Type.STRING, description: "探索者たちがゲームをクリアするための具体的な条件。" },
    failureCondition: { type: Type.STRING, description: "探索者たちがゲームオーバーまたは失敗となる具体的な条件。" },
    truth: { type: Type.STRING, description: "このシナリオの核心にある秘密や真相。探索者たちが最終的にたどり着くべき、あるいは直面する宇宙的恐怖の真実。" },
    estimatedPlayTime: { type: Type.STRING, description: "このシナリオをクリアするまでの推定プレイ時間（例：「1~2時間」）。" }
  },
  required: ["title", "summary", "clearCondition", "failureCondition", "truth", "estimatedPlayTime"]
};

export const generateScenarioOutline = async (
  characters: Character[],
  options: {
    playTime?: string;
    difficulty?: string;
    synopsis?: string;
  } = {}
): Promise<ScenarioOutline> => {
  const characterInfos = characters.map(c => `- **${c.name}** (${c.occupation})`).join('\n');

  const optionsText = [
    options.playTime && `- **希望するプレイ時間**: ${options.playTime}`,
    options.difficulty && `- **希望する難易度**: ${options.difficulty}`,
    options.synopsis ? `- **あらすじや設定など**: ${options.synopsis}` : "舞台は1920年代のアメリカ、マサチューセッツ州アーカム周辺。ユニークで、サスペンスに満ちた物語です。"
  ].filter(Boolean).join('\n');

  const prompt = `
    TRPGのシナリオ概要を1つ生成してください。
    以下の探索者たちが遭遇する物語の骨子を考えてください。

    ### 参加する探索者
    ${characterInfos}

    上記の探索者の特徴を少しだけシナリオに反映させてください。
    ${optionsText ? `\n以下の要望を考慮してシナリオを生成してください。\n${optionsText}` : '\nプレイヤーたち（探索者たち）を恐怖と狂気の世界へと誘う、魅力的でサスペンスに満ちたクトゥルフ神話のシナリオを紡ぎます。舞台は1920年代のアメリカ、マサチューセッツ州の架空の都市「アーカム」から始まります。その他の内容は完全にあなた（AI）に任せます。'}

    必ず指示されたJSON形式で、日本語で出力してください。
  `;

  try {
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        responseSchema: scenarioOutlineSchema
      }
    });
    const jsonText = response.text?.trim().replace(/^```json\s*|```$/g, '') || '';
    const parsed = JSON.parse(jsonText);
    return parsed as ScenarioOutline;
  } catch (error) {
    console.error("AI scenario outline generation failed:", error);
    // Fallback scenario
    return {
      title: "古い屋敷の謎",
      summary: "探索者たちは、アーカム郊外の古い屋敷の相続問題に巻き込まれる。その屋敷には、かつての主人が残した恐ろしい秘密が隠されている。",
      clearCondition: "屋敷の秘密を解き明かし、そこに潜む脅威を排除または封印する。",
      failureCondition: "探索者全員が死亡または発狂する。あるいは、脅威を解放してしまう。",
      truth: "屋敷の主人は、異次元の存在を崇拝するカルトの一員であり、屋敷の地下にその存在を呼び出すためのゲートを構築していた。",
      estimatedPlayTime: "3〜4時間"
    };
  }
};

export const startNewGame = async (chat: Chat, characters: Character[], scenario: ScenarioOutline): Promise<KeeperResponse> => {
  const characterInfos = characters.map(formatCharacterInfo).join('\n\n');

  const prompt = `
    新しいゲームを開始します。
    まず、ゲームキーパーであるあなただけが知る、今回のシナリオの全体像を以下に示します。この内容を常に念頭に置き、物語がこの骨子から大きく逸脱しないように進行してください。

    --- シナリオ概要 (内部情報) ---
    - **シナリオ名**: ${scenario.title}
    - **概要**: ${scenario.summary}
    - **クリア条件**: ${scenario.clearCondition}
    - **失敗条件**: ${scenario.failureCondition}
    - **真相**: ${scenario.truth}
    - **推定プレイ時間**: ${scenario.estimatedPlayTime}
    ---------------------------------

    これが今回の探索者（プレイヤーキャラクター）たちの情報です。
    この探索者たちを中心として、上記のシナリオに基づいたTRPGの物語を始めてください。
    最初の導入部分を具体的に描写し、探索者たちが最初に行うべき行動を問いかけ、行動の選択肢を提示してください。

    ### 探索者情報
    ${characterInfos}
  `;

  const response = await chat.sendMessage({ message: prompt });
  return parseResponse(response);
};

export const sendPlayerAction = async (
  chat: Chat,
  action: string,
  characters: Character[],
  rollResult?: { characterName: string; skill: string; value: number; result: string; dice: number }
): Promise<KeeperResponse> => {

  let prompt = `探索者たちの行動: 「${action}」`;

  if (rollResult) {
    prompt += `
      \n\n技能判定の結果 (${rollResult.characterName}):
      - 技能: ${rollResult.skill}（技能値: ${rollResult.value}）
      - ダイス結果: ${rollResult.dice}
      - 判定: ${rollResult.result}
      \nこの判定結果を反映して、物語を続けてください。
    `;
  }

  const characterStatus = characters.map(c => {
    let status = `- ${c.name}: HP ${c.hp.current}/${c.hp.max}, SAN ${c.san.current}/${c.san.max}`;
    if (c.madness && c.madness.type) {
      const madnessType = c.madness.type === 'temporary' ? '一時的狂気' : '不定の狂気';
      status += ` [${madnessType}: ${c.madness.description}`;
      if (c.madness.duration && c.madness.duration > 0) {
        status += ` (残り${c.madness.duration}ラウンド)`;
      }
      status += `]`;
    }
    return status;
  }).join('\n');

  // 狂気状態の探索者がいるかチェック
  const hasMadCharacters = characters.some(c => c.madness && c.madness.type);

  prompt += `
    \n\n現在の探索者たちの状態:
    ${characterStatus}`;

  // 狂気状態の探索者がいる場合のみルールを追加
  if (hasMadCharacters) {
    prompt += `

    **重要**: 狂気状態の探索者については以下のルールを適用してください：
    - 一時的狂気：症状に応じた行動制限（例：パニック状態なら逃走したがる、ヒステリーなら叫び続ける）
    - 不定の狂気：継続的な症状による行動や判定への影響
    - 狂気状態と矛盾する行動（冷静な判断、説得など）は失敗しやすくなる`;
  }

  prompt += `
    
    この行動と現在の状態に基づき、物語の次のステップを描写し、新たな行動の選択肢を提示してください。
  `
  const response = await chat.sendMessage({ message: prompt });
  return parseResponse(response);
};

export const generateCharacterBackground = async (name: string, occupation: string): Promise<string> => {
  const prompt = `
    TRPGの探索者設定を生成してください。
    - **名前**: ${name || '無名の探索者'}
    - **職業**: ${occupation || '無職'}
    
    上記のキャラクターに合う、ユニークで、ミステリアスな雰囲気を持ち、今後の物語のフックとなりうるような「キャラクター設定」を200文字程度で記述してください。
    設定には、キャラクターの簡単な背景、性格、外見の特徴などを、物語性を感じさせるように含めてください。
  `;

  try {
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            background: {
              type: Type.STRING,
              description: "生成されたキャラクターの背景設定。"
            }
          },
          required: ["background"]
        }
      }
    });

    const jsonText = response.text?.trim().replace(/^```json\s*|```$/g, '') || '';
    const parsed = JSON.parse(jsonText);
    return parsed.background;

  } catch (error) {
    console.error("AI background generation failed:", error);
    return "予期せぬエラーにより、背景を生成できませんでした。";
  }
};
