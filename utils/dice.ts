
/**
 * 指定された数の面を持つダイスを1つ振ります。
 * @param sides ダイスの面の数 (例: 6, 20, 100)
 * @returns 1からsidesまでのランダムな整数
 */
export const rollDie = (sides: number): number => {
  return Math.floor(Math.random() * sides) + 1;
};

/**
 * 複数の同じ種類のダイスを振ります。
 * @param count ダイスの数
 * @param sides ダイスの面の数
 * @returns ダイスの目の合計値
 */
export const rollDice = (count: number, sides: number): number => {
  let total = 0;
  for (let i = 0; i < count; i++) {
    total += rollDie(sides);
  }
  return total;
};

/**
 * "1d6" や "2d8+2" のようなダイス表記を解析してダイスを振ります。
 * @param notation ダイス表記文字列
 * @returns ダイスの目の合計値
 */
export const parseAndRoll = (notation: string): number => {
    const sanitized = notation.toLowerCase().replace(/\s+/g, '');
    const match = sanitized.match(/(\d+)?d(\d+)([+-]\d+)?/);

    if (!match) return 0;

    const numDice = match[1] ? parseInt(match[1], 10) : 1;
    const numSides = parseInt(match[2], 10);
    const modifier = match[3] ? parseInt(match[3], 10) : 0;

    let total = 0;
    for (let i = 0; i < numDice; i++) {
        total += rollDie(numSides);
    }

    return total + modifier;
};
