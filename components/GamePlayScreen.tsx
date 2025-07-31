
import React, { useState, useRef, useEffect, useCallback } from 'react';
import type { Character, KeeperResponse, Message, Reward, ScenarioOutline } from '../types';
import { MessageSender } from '../types';
import { createChatSession, startNewGame, sendPlayerAction } from '../services/keeperAI';
import type { Chat } from '@google/genai';
import { parseAndRoll, rollDie } from '../utils/dice';
import { CharacterStatus } from './CharacterStatus';
import { Send, Dices, BrainCircuit, HelpCircle, Bot, User, X, Users, AlertTriangle } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import { DiceRollModal } from './DiceRollModal';

// 狂気症状のデータ
const TEMPORARY_MADNESS_SYMPTOMS = [
    "恐怖で震えが止まらない（全ての行動に-20のペナルティ）",
    "パニック状態となり、その場から逃げ出そうとする",
    "恐怖のあまり失神し、1d10ラウンドの間行動不能",
    "ヒステリック状態となり、大声で叫び続ける",
    "硬直状態となり、1d6ラウンドの間身動きが取れない",
    "記憶が混乱し、直前の出来事を忘れてしまう",
    "幻覚を見始め、存在しないものに反応する",
    "極度の疑心暗鬼となり、仲間を信用できなくなる"
];

const INDEFINITE_MADNESS_SYMPTOMS = [
    "恐怖症：特定の対象に対する極度の恐怖（技能判定-30）",
    "強迫観念：特定の行動を繰り返さずにはいられない",
    "妄想症：現実と妄想の区別がつかなくなる",
    "健忘症：重要な記憶の一部を失う",
    "人格解離：別の人格が現れることがある",
    "躁鬱状態：極端な気分の変動に悩まされる",
    "被害妄想：常に誰かに狙われていると感じる",
    "幻聴・幻覚：存在しない声や映像を知覚する"
];

// 狂気判定と症状決定
const checkForMadness = (character: Character, sanLoss: number): { type: 'temporary' | 'indefinite' | null; description: string; duration?: number } => {
    // 不定狂気の閾値を計算（SAN最大値の1/5）
    const indefiniteMadnessThreshold = Math.ceil(character.san.max * 0.2);

    // 不定狂気の閾値以上の損失で不定の狂気（優先判定）
    if (sanLoss >= indefiniteMadnessThreshold) {
        const symptom = INDEFINITE_MADNESS_SYMPTOMS[Math.floor(Math.random() * INDEFINITE_MADNESS_SYMPTOMS.length)];
        return { type: 'indefinite', description: symptom }; // durationは設定しない
    } else if (sanLoss >= 5) {
        // 一度に5以上のSAN損失で一時的狂気
        const symptom = TEMPORARY_MADNESS_SYMPTOMS[Math.floor(Math.random() * TEMPORARY_MADNESS_SYMPTOMS.length)];
        const duration = Math.floor(Math.random() * 6) + 1; // 1d6ラウンド
        return { type: 'temporary', description: symptom, duration };
    }

    return { type: null, description: '' };
};

const MessageIcon: React.FC<{ sender: MessageSender }> = ({ sender }) => {
    if (sender === MessageSender.Player) {
        return <User className="h-5 w-5 text-purple-300" />;
    }
    if (sender === MessageSender.Keeper) {
        return <Bot className="h-5 w-5 text-gray-400" />;
    }
    return null;
}

const ChatMessage: React.FC<{ message: Message }> = ({ message }) => {
    const isPlayer = message.sender === MessageSender.Player;
    const isSystem = message.sender === MessageSender.System;

    if (isSystem) {
        return (
            <div className="flex justify-center my-4">
                <div className="p-3 rounded-lg bg-yellow-900/50 border border-yellow-700/50 text-yellow-200 italic text-center text-sm shadow-md max-w-xl">
                    <ReactMarkdown>{message.content}</ReactMarkdown>
                </div>
            </div>
        );
    }

    return (
        <div className={`flex items-start gap-3 my-4 ${isPlayer ? 'flex-row-reverse' : 'flex-row'}`}>
            <div className={`flex-shrink-0 w-10 h-10 rounded-full flex items-center justify-center mt-1 ${isPlayer ? 'bg-purple-900/80' : 'bg-gray-700'}`}>
                <MessageIcon sender={message.sender} />
            </div>
            <div className={`p-4 rounded-lg max-w-xl shadow-md prose prose-invert prose-p:my-2 prose-headings:text-purple-300 prose-strong:text-white prose-blockquote:border-l-purple-400 ${isPlayer ? 'bg-purple-900/60' : 'bg-gray-800'}`}>
                <ReactMarkdown>{message.content}</ReactMarkdown>
            </div>
        </div>
    );
};

interface ActionModalProps {
    characters: Character[];
    action: { type: 'skill', skill: string }
    | { type: 'sanity', roll: string, reason: string, targetAll?: boolean }
    | { type: 'stat', stat: keyof Character['stats'], multiplier?: number, reason: string };
    onClose: () => void;
    onSelect: (characterId: string | 'all') => void;
}

const ActionModal: React.FC<ActionModalProps> = ({ characters, action, onClose, onSelect }) => {
    const title = action.type === 'skill'
        ? `技能判定: 〈${action.skill}〉`
        : action.type === 'stat'
            ? `能力値判定: ${action.reason}`
            : `正気度チェック: ${action.reason}`;

    const subtitle = action.type === 'skill' || action.type === 'stat'
        ? '誰が判定を行いますか？'
        : '誰がチェックを受けますか？';

    return (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
            <div className="bg-gray-800 rounded-lg shadow-xl p-6 border border-purple-500/30 w-full max-w-md">
                <div className="flex justify-between items-center mb-4">
                    <h2 className="text-xl font-bold font-crimson text-purple-300">{title}</h2>
                    <button onClick={onClose} className="text-gray-400 hover:text-white"><X size={24} /></button>
                </div>
                <p className="text-gray-300 mb-6">{subtitle}</p>
                <div className="space-y-3">
                    {action.type === 'sanity' && action.targetAll && (
                        <button
                            onClick={() => onSelect('all')}
                            className="w-full text-center px-4 py-3 bg-red-700 hover:bg-red-600 text-white font-bold rounded-lg transition-colors transform hover:scale-105"
                        >
                            全員でSAN値チェック
                        </button>
                    )}
                    {characters.map(char => (
                        <button key={char.id} onClick={() => onSelect(char.id)}
                            className="w-full text-left px-4 py-3 bg-gray-700 hover:bg-gray-600 text-gray-200 font-semibold rounded-lg transition-colors transform hover:scale-105">
                            <div className="flex justify-between items-center">
                                <span>{char.name}</span>
                                <span className="text-sm text-gray-400">HP: {char.hp.current} / SAN: {char.san.current}</span>
                            </div>
                        </button>
                    ))}
                </div>
            </div>
        </div>
    );
};

interface GamePlayScreenProps {
    initialCharacters: Character[];
    initialScenario: ScenarioOutline;
    onGameClear: (rewards: Reward[] | null) => void;
    onGameOver: () => void;
}


export const GamePlayScreen: React.FC<GamePlayScreenProps> = ({ initialCharacters, initialScenario, onGameClear, onGameOver }) => {
    const [characters, setCharacters] = useState<Character[]>(initialCharacters);
    const [messages, setMessages] = useState<Message[]>([]);
    const [input, setInput] = useState('');
    const [isLoading, setIsLoading] = useState(true);
    const [pendingAction, setPendingAction] = useState<KeeperResponse | null>(null);
    const [modalAction, setModalAction] = useState<ActionModalProps['action'] | null>(null);
    const [chatSession, setChatSession] = useState<Chat | null>(null);
    const [isSidebarOpen, setIsSidebarOpen] = useState(false);
    const [lastFailedSkillCheck, setLastFailedSkillCheck] = useState<{ characterId: string; skill: string; value: number; dice: number; result: string; } | null>(null);
    const [diceRollRequest, setDiceRollRequest] = useState<{ notation: string; reason: string; onComplete: (result: number) => void; } | null>(null);

    const chatEndRef = useRef<HTMLDivElement>(null);
    const actionButtonClasses = "px-4 py-2 bg-gray-700/80 hover:bg-gray-700 backdrop-blur-sm border border-purple-500/20 text-gray-200 font-semibold rounded-lg transition-colors flex items-center justify-center shadow-md";


    const scrollToBottom = () => {
        chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
    };

    useEffect(() => {
        scrollToBottom();
    }, [messages]);

    const updateCharacterState = useCallback((charId: string, updates: Partial<Character> | ((char: Character) => Character)) => {
        setCharacters(prev => prev.map(c => {
            if (c.id === charId) {
                if (typeof updates === 'function') {
                    return updates(c);
                }
                return { ...c, ...updates };
            }
            return c;
        }));
    }, []);

    // 一時的狂気のラウンド数を減らす関数
    const decrementMadnessDuration = useCallback(() => {
        setCharacters(prev => {
            const updatedCharacters = prev.map(character => {
                if (character.madness?.type === 'temporary' && character.madness.duration !== undefined && character.madness.duration > 0) {
                    const newDuration = character.madness.duration - 1;

                    if (newDuration <= 0) {
                        // 一時的狂気が回復
                        setTimeout(() => {
                            const recoveryMessage = `✨ **一時的狂気回復: ${character.name}**\n時間の経過により一時的狂気が回復した。`;
                            setMessages(prevMessages => [...prevMessages, {
                                id: `auto-madness-recovery-${Date.now()}-${prevMessages.length}`,
                                content: recoveryMessage,
                                sender: MessageSender.System
                            }]);
                        }, 100);

                        return {
                            ...character,
                            madness: { type: null, description: '' }
                        };
                    } else {
                        return {
                            ...character,
                            madness: {
                                ...character.madness,
                                duration: newDuration
                            }
                        };
                    }
                }
                return character;
            });

            return updatedCharacters;
        });
    }, []);

    const processKeeperResponse = useCallback((response: KeeperResponse) => {
        setMessages(prev => [...prev, { id: `keeper-${Date.now()}-${prev.length}`, content: response.description, sender: MessageSender.Keeper }]);

        // 狂気回復の処理
        if (response.madnessRecovery) {
            const { characterId, reason, type } = response.madnessRecovery;
            console.log(`[DEBUG] Madness recovery request:`, { characterId, reason, type });
            console.log(`[DEBUG] Available characters:`, characters.map(c => ({ id: c.id, name: c.name, madness: c.madness })));

            setCharacters(prev => {
                const character = prev.find(c => c.id === characterId);
                console.log(`[DEBUG] Found character:`, character ? { id: character.id, name: character.name, madness: character.madness } : 'null');

                if (character && character.madness?.type) {
                    const shouldRecover =
                        type === 'both' ||
                        (type === 'temporary' && character.madness.type === 'temporary') ||
                        (type === 'indefinite' && character.madness.type === 'indefinite');

                    if (shouldRecover) {
                        const recoveryMessage = `✨ **狂気回復: ${character.name}**\n${reason}により、${character.madness.type === 'temporary' ? '一時的狂気' : '不定の狂気'}が回復した。`;

                        // 回復メッセージを即座に追加
                        setTimeout(() => {
                            setMessages(prevMessages => [...prevMessages, {
                                id: `madness-recovery-${Date.now()}-${prevMessages.length}`,
                                content: recoveryMessage,
                                sender: MessageSender.System
                            }]);
                        }, 100);

                        return prev.map(c =>
                            c.id === characterId
                                ? { ...c, madness: { type: null, description: '' } }
                                : c
                        );
                    }
                } else {
                    // 狂気状態でないキャラクターの場合の警告メッセージ
                    const warningMessage = `⚠️ **回復処理**: ${character?.name || '不明なキャラクター'}は現在狂気状態ではありません。`;
                    setTimeout(() => {
                        setMessages(prevMessages => [...prevMessages, {
                            id: `madness-recovery-warning-${Date.now()}`,
                            content: warningMessage,
                            sender: MessageSender.System
                        }]);
                    }, 100);
                }

                return prev;
            });
        }

        if (response.gameClear) {
            onGameClear(response.rewards);
            setIsLoading(false);
            setPendingAction(null);
        } else if (response.gameOver) {
            setMessages(prev => [...prev, { id: `gameover-${Date.now()}-${prev.length}`, content: "### ゲームオーバー\n\nあなたたちの物語はここで終わりを告げる。", sender: MessageSender.System }]);
            onGameOver();
            setIsLoading(false);
            setPendingAction(null);
        } else {
            setPendingAction(response);
            setIsLoading(false);
        }
    }, [onGameClear, onGameOver]);

    useEffect(() => {
        const startGame = async () => {
            setIsLoading(true);
            const names = initialCharacters.map(c => `**${c.name}**`).join('、');

            const titleMessage = `### シナリオ: ${initialScenario.title}\n*推定プレイ時間: ${initialScenario.estimatedPlayTime}*`;
            setMessages(prev => [...prev,
            { id: `title-${Date.now()}`, content: titleMessage, sender: MessageSender.System },
            { id: `welcome-${Date.now()}`, content: `ようこそ、探索者 ${names}。\n物語が始まります...`, sender: MessageSender.System }
            ]);

            const chat = createChatSession();
            setChatSession(chat);

            const response = await startNewGame(chat, initialCharacters, initialScenario);
            setMessages(prev => [...prev, { id: `keeper-start-${Date.now()}`, content: response.description, sender: MessageSender.Keeper }]);

            if (response.gameClear) {
                onGameClear(response.rewards);
                setIsLoading(false);
                setPendingAction(null);
            } else if (response.gameOver) {
                setMessages(prev => [...prev, { id: `gameover-${Date.now()}`, content: "### ゲームオーバー\n\nあなたたちの物語はここで終わりを告げる。", sender: MessageSender.System }]);
                onGameOver();
                setIsLoading(false);
                setPendingAction(null);
            } else {
                setPendingAction(response);
                setIsLoading(false);
            }
        };

        if (!chatSession) {
            startGame();
        }
    }, [initialCharacters, initialScenario, onGameClear, onGameOver]);

    const handlePlayerAction = useCallback(async (actionText: string, rollResult?: { characterName: string; skill: string; value: number; result: string; dice: number }) => {
        if (!actionText.trim() || !chatSession) return;

        // プレイヤー行動時に一時的狂気のラウンド数を減少
        decrementMadnessDuration();

        setLastFailedSkillCheck(null);
        setMessages(prev => [...prev, { id: `player-${Date.now()}-${prev.length}`, content: actionText, sender: MessageSender.Player }]);
        setIsLoading(true);
        setPendingAction(null);
        setInput('');

        const response = await sendPlayerAction(chatSession, actionText, characters, rollResult);
        processKeeperResponse(response);
    }, [characters, processKeeperResponse, chatSession, decrementMadnessDuration]);

    const handleSystemAction = useCallback(async (actionText: string, systemMessage: string) => {
        if (!chatSession) return;

        setLastFailedSkillCheck(null);
        setMessages(prev => [...prev, { id: `system-${Date.now()}-${prev.length}`, content: systemMessage, sender: MessageSender.System }]);
        setIsLoading(true);
        setPendingAction(null);

        const response = await sendPlayerAction(chatSession, actionText, characters);
        processKeeperResponse(response);
    }, [characters, processKeeperResponse, chatSession]);


    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (input.trim()) {
            handlePlayerAction(input);
        }
    };

    const handleSuggestedActionClick = (action: string) => {
        setLastFailedSkillCheck(null);
        handlePlayerAction(action);
    };

    const handleSkillCheck = useCallback((skill: string, characterId: string) => {
        setPendingAction(null);
        setLastFailedSkillCheck(null);

        // 技能判定実行時に一時的狂気のラウンド数を減少
        decrementMadnessDuration();

        const character = characters.find(c => c.id === characterId)!;
        const cleanedSkill = skill.replace(/[〈〉]/g, '');
        const skillValue = character.skills[cleanedSkill] ?? 0;

        setDiceRollRequest({
            notation: '1d100',
            reason: `技能判定: 〈${cleanedSkill}〉`,
            onComplete: (diceRoll) => {
                setDiceRollRequest(null);

                let result: string;
                if (diceRoll <= 1) result = "クリティカル (01)";
                else if (diceRoll <= skillValue / 5) result = "イクストリーム成功";
                else if (diceRoll <= skillValue / 2) result = "ハード成功";
                else if (diceRoll <= skillValue) result = "レギュラー成功";
                else if (diceRoll >= 100) result = "ファンブル (00)";
                else if (diceRoll >= 96 && skillValue < 50) result = "ファンブル";
                else result = "失敗";

                const isSuccess = result !== '失敗' && result !== 'ファンブル' && result !== 'ファンブル (00)';

                const message = `🎲 **技能判定: 〈${cleanedSkill}〉 (${character.name})**\n- **結果:** ${diceRoll} (目標: ${skillValue})\n- **判定:** ${result}`;
                setMessages(prev => [...prev, { id: `skill-check-${Date.now()}-${prev.length}`, content: message, sender: MessageSender.System }]);

                if (isSuccess) {
                    const sendResult = async () => {
                        if (!chatSession) return;
                        setIsLoading(true);
                        const response = await sendPlayerAction(
                            chatSession,
                            `${character.name}が〈${cleanedSkill}〉の技能判定を行った。`,
                            characters,
                            { characterName: character.name, skill: cleanedSkill, value: skillValue, result: result, dice: diceRoll }
                        );
                        processKeeperResponse(response);
                    }
                    sendResult();
                } else {
                    setLastFailedSkillCheck({ characterId, skill: cleanedSkill, value: skillValue, dice: diceRoll, result: result });
                }
            }
        });
    }, [characters, chatSession, processKeeperResponse, decrementMadnessDuration]);

    const handleStatCheck = useCallback((stat: keyof Character['stats'], multiplier: number = 5, reason: string, characterId: string) => {
        setPendingAction(null);
        setLastFailedSkillCheck(null);

        // 能力値判定実行時に一時的狂気のラウンド数を減少
        decrementMadnessDuration();

        const character = characters.find(c => c.id === characterId)!;;
        const statValue = character.stats[stat] ?? 0;
        const targetValue = statValue * multiplier;
        const checkName = `${stat}×${multiplier}`;

        setDiceRollRequest({
            notation: '1d100',
            reason: `能力値判定: ${reason}`,
            onComplete: (diceRoll) => {
                setDiceRollRequest(null);

                let result: string;
                if (diceRoll <= 1) result = "クリティカル (01)";
                else if (diceRoll <= targetValue / 5) result = "イクストリーム成功";
                else if (diceRoll <= targetValue / 2) result = "ハード成功";
                else if (diceRoll <= targetValue) result = "レギュラー成功";
                else if (diceRoll >= 100) result = "ファンブル (00)";
                else if (diceRoll >= 96 && targetValue < 50) result = "ファンブル";
                else result = "失敗";

                const isSuccess = result !== '失敗' && result !== 'ファンブル' && result !== 'ファンブル (00)';

                const message = `🎲 **能力値判定: ${reason} (${character.name})**\n- **結果:** ${diceRoll} (目標: ${targetValue} - ${checkName})\n- **判定:** ${result}`;
                setMessages(prev => [...prev, { id: `stat-check-${Date.now()}-${prev.length}`, content: message, sender: MessageSender.System }]);

                if (isSuccess) {
                    const sendResult = async () => {
                        if (!chatSession) return;
                        setIsLoading(true);
                        const response = await sendPlayerAction(
                            chatSession,
                            `${character.name}が「${reason}」のため能力値判定(${checkName})を行った。`,
                            characters,
                            { characterName: character.name, skill: checkName, value: targetValue, result: result, dice: diceRoll }
                        );
                        processKeeperResponse(response);
                    }
                    sendResult();
                } else {
                    setLastFailedSkillCheck({ characterId, skill: checkName, value: targetValue, dice: diceRoll, result: result });
                }
            }
        });
    }, [characters, chatSession, processKeeperResponse, decrementMadnessDuration]);

    const handleDeclinePushRoll = () => {
        if (!lastFailedSkillCheck || !chatSession) return;
        const { characterId, skill, value, dice, result } = lastFailedSkillCheck;
        const character = characters.find(c => c.id === characterId)!;

        setLastFailedSkillCheck(null);

        const actionTextForAI = `${character.name}が〈${skill}〉の技能判定に失敗し、プッシュは行わないことにした。`;

        const sendFailureToAI = async () => {
            setIsLoading(true);
            setPendingAction(null);

            const response = await sendPlayerAction(
                chatSession,
                actionTextForAI,
                characters,
                { characterName: character.name, skill, value, result, dice }
            );
            processKeeperResponse(response);
        };

        sendFailureToAI();
    };

    const handlePushRoll = () => {
        if (!lastFailedSkillCheck || !chatSession) return;
        const { characterId, skill, value } = lastFailedSkillCheck;
        const character = characters.find(c => c.id === characterId)!;

        // プッシュロール実行時に一時的狂気のラウンド数を減少
        decrementMadnessDuration();

        const systemMessage = `**プッシュ・ロール！**\n${character.name}は失敗にも屈せず、再び〈${skill}〉に挑戦する...！しかし、これに失敗すれば、ただでは済まないだろう。`;
        setMessages(prev => [...prev, { id: `push-start-${Date.now()}-${prev.length}`, content: systemMessage, sender: MessageSender.System }]);
        setLastFailedSkillCheck(null);
        setIsLoading(true);

        setDiceRollRequest({
            notation: '1d100',
            reason: `プッシュ・ロール: 〈${skill}〉`,
            onComplete: (diceRoll) => {
                setDiceRollRequest(null);

                let result: string;
                if (diceRoll <= 1) result = "クリティカル (01)";
                else if (diceRoll <= value / 5) result = "イクストリーム成功";
                else if (diceRoll <= value / 2) result = "ハード成功";
                else if (diceRoll <= value) result = "レギュラー成功";
                else if (diceRoll >= 100) result = "ファンブル (00)";
                else if (diceRoll >= 96 && value < 50) result = "ファンブル";
                else result = "失敗";

                const pushMessage = `🎲 **プッシュ結果: 〈${skill}〉 (${character.name})**\n- **結果:** ${diceRoll} (目標: ${value})\n- **判定:** ${result}`;
                setMessages(prev => [...prev, { id: `push-result-${Date.now()}-${prev.length}`, content: pushMessage, sender: MessageSender.System }]);

                const sendPushedResult = async () => {
                    const response = await sendPlayerAction(
                        chatSession,
                        `${character.name}はリスクを覚悟で〈${skill}〉を再度試みた（プッシュ・ロール）。`,
                        characters,
                        { characterName: character.name, skill: skill, value: value, result: result, dice: diceRoll }
                    );
                    processKeeperResponse(response);
                };
                sendPushedResult();
            }
        });
    };


    // 固定値かどうかを判定するヘルパー関数（共通）
    const isFixedValue = (notation: string): boolean => {
        const trimmed = notation.trim();
        console.log(`[DEBUG] isFixedValue checking: "${notation}" -> trimmed: "${trimmed}"`);
        const result = /^\d+$/.test(trimmed);
        console.log(`[DEBUG] isFixedValue result:`, result);
        return result;
    };

    // 固定値の場合は直接値を返す（共通）
    const parseFixedOrRoll = (notation: string): number => {
        console.log(`[DEBUG] parseFixedOrRoll called with: "${notation}"`);
        console.log(`[DEBUG] notation type:`, typeof notation);
        console.log(`[DEBUG] notation length:`, notation.length);
        console.log(`[DEBUG] notation charCodes:`, [...notation].map(c => c.charCodeAt(0)));

        if (isFixedValue(notation)) {
            const trimmed = notation.trim();
            const result = parseInt(trimmed, 10);
            console.log(`[DEBUG] parseInt("${trimmed}", 10) =`, result);
            console.log(`[DEBUG] isNaN(result):`, isNaN(result));
            return isNaN(result) ? 0 : result;
        }
        // ダイスロールが必要な場合は-1を返す（後でダイスロールする）
        console.log(`[DEBUG] Recognized as dice notation, returning -1`);
        return -1;
    };

    const handleSanityCheck = (roll: string, reason: string, characterId: string | 'all') => {
        setLastFailedSkillCheck(null);

        // デバッグ：入力されたroll文字列を確認
        console.log(`[DEBUG] handleSanityCheck called with roll: "${roll}"`);

        // SANチェック実行時に一時的狂気のラウンド数を減少
        decrementMadnessDuration();

        // 全員でのSANチェック結果を処理するヘルパー関数
        const processAllCharactersSanCheck = (
            results: Array<{ character: Character, sanRoll: number, isSuccess: boolean }>,
            successLoss: number,
            failureLoss: number,
            reason: string
        ) => {
            const resultMessages: string[] = [];
            let anyMadness = false;
            let gameOverCharacter: Character | null = null;

            results.forEach(({ character, sanRoll, isSuccess }) => {
                const currentSan = character.san.current;
                const actualLoss = isSuccess ? successLoss : failureLoss;
                const newSan = Math.max(0, currentSan - actualLoss);

                let madnessResult: { type: 'temporary' | 'indefinite' | null; description: string; duration?: number } = { type: null, description: '' };
                let madnessMessage = '';

                if (actualLoss > 0) {
                    madnessResult = checkForMadness(character, actualLoss);
                    if (madnessResult.type) {
                        anyMadness = true;
                        madnessMessage = madnessResult.type === 'temporary'
                            ? ` **一時的狂気発症**: ${madnessResult.description}`
                            : ` **不定の狂気発症**: ${madnessResult.description}`;
                    }
                }

                const resultText = isSuccess ? "成功" : "失敗";
                const comparisonSymbol = isSuccess ? "≤" : ">";

                resultMessages.push(`**${character.name}**: ${sanRoll} ${comparisonSymbol} ${currentSan} → ${resultText}${actualLoss > 0 ? ` (SAN損失: ${actualLoss})` : ''}${madnessMessage}`);

                updateCharacterState(character.id, c => ({
                    ...c,
                    san: { ...c.san, current: newSan },
                    madness: madnessResult.type ? {
                        type: madnessResult.type,
                        description: madnessResult.description,
                        ...(madnessResult.duration !== undefined ? { duration: madnessResult.duration } : {})
                    } : c.madness
                }));

                // SAN値が0以下になったキャラクターをチェック
                if (newSan <= 0 && !gameOverCharacter) {
                    gameOverCharacter = character;
                }
            });

            const message = `🧠 **全員の正気度チェック: ${reason}**\n${resultMessages.join('\n')}`;

            // SAN値が0以下になったキャラクターがいる場合は即座にゲームオーバー
            if (gameOverCharacter) {
                setMessages(prev => [...prev, 
                    { id: `sancheck-all-result-${Date.now()}`, content: message, sender: MessageSender.System },
                    { id: `gameover-san-all-${Date.now()}`, content: `### ゲームオーバー\n\n${gameOverCharacter!.name}の正気度が完全に失われた。もはや元の人格は存在しない...`, sender: MessageSender.System }
                ]);
                onGameOver();
                setIsLoading(false);
                setPendingAction(null);
                return;
            }

            const actionText = `全員が「${reason}」による正気度チェックを行った。${anyMadness ? '一部のキャラクターに狂気が発症。' : ''}`;
            handleSystemAction(actionText, message);
        };

        if (characterId === 'all') {
            // 全員でSANチェック
            setDiceRollRequest({
                notation: '1d100',
                reason: `全員の正気度チェック: ${reason}`,
                onComplete: (firstRoll) => {
                    // 成功/失敗判定用のダイスロール結果を全員に使用
                    const sanCheckRoll = firstRoll;

                    // SAN損失のダイスロールを別途実行
                    const rollParts = roll.split('/');

                    if (rollParts.length === 2) {
                        // "1/1d8" 形式の場合、まず成功者を判定してから適切なSAN損失を決定
                        const results: Array<{ character: Character, sanRoll: number, isSuccess: boolean }> = [];

                        characters.forEach(character => {
                            const currentSan = character.san.current;
                            const isSuccess = sanCheckRoll <= currentSan;
                            results.push({ character, sanRoll: sanCheckRoll, isSuccess });
                        });

                        // 成功者と失敗者がいるかチェック
                        const hasSuccess = results.some(r => r.isSuccess);
                        const hasFailure = results.some(r => !r.isSuccess);

                        if (hasSuccess && hasFailure) {
                            // 成功者と失敗者がいる場合、両方のSAN損失をロール
                            const successRoll = rollParts[0];
                            const failureRoll = rollParts[1];

                            // 成功時のSAN損失を処理（固定値またはダイスロール）
                            const successFixed = parseFixedOrRoll(successRoll);
                            if (successFixed >= 0) {
                                // 成功時が固定値の場合、失敗時の処理へ
                                const failureFixed = parseFixedOrRoll(failureRoll);
                                if (failureFixed >= 0) {
                                    // 両方固定値の場合
                                    console.log(`[DEBUG] Both success and failure are fixed values: ${successFixed}, ${failureFixed}`);
                                    setDiceRollRequest(null);
                                    processAllCharactersSanCheck(results, successFixed, failureFixed, reason);
                                } else {
                                    // 成功時固定値、失敗時ダイスロール
                                    setDiceRollRequest({
                                        notation: failureRoll,
                                        reason: `失敗時のSAN損失: ${reason}`,
                                        onComplete: (failureLoss) => {
                                            setDiceRollRequest(null);
                                            processAllCharactersSanCheck(results, successFixed, failureLoss, reason);
                                        }
                                    });
                                }
                            } else {
                                // 成功時がダイスロールの場合
                                setDiceRollRequest({
                                    notation: successRoll,
                                    reason: `成功時のSAN損失: ${reason}`,
                                    onComplete: (successLoss) => {
                                        const failureFixed = parseFixedOrRoll(failureRoll);
                                        if (failureFixed >= 0) {
                                            // 成功時ダイスロール、失敗時固定値
                                            setDiceRollRequest(null);
                                            processAllCharactersSanCheck(results, successLoss, failureFixed, reason);
                                        } else {
                                            // 両方ダイスロール
                                            setDiceRollRequest({
                                                notation: failureRoll,
                                                reason: `失敗時のSAN損失: ${reason}`,
                                                onComplete: (failureLoss) => {
                                                    setDiceRollRequest(null);
                                                    processAllCharactersSanCheck(results, successLoss, failureLoss, reason);
                                                }
                                            });
                                        }
                                    }
                                });
                            }
                        } else if (hasSuccess) {
                            // 全員成功の場合
                            const successFixed = parseFixedOrRoll(rollParts[0]);
                            if (successFixed >= 0) {
                                // 固定値の場合
                                console.log(`[DEBUG] All success with fixed value: ${successFixed}`);
                                setDiceRollRequest(null);
                                processAllCharactersSanCheck(results, successFixed, 0, reason);
                            } else {
                                // ダイスロールの場合
                                setDiceRollRequest({
                                    notation: rollParts[0],
                                    reason: `成功時のSAN損失: ${reason}`,
                                    onComplete: (successLoss) => {
                                        setDiceRollRequest(null);
                                        processAllCharactersSanCheck(results, successLoss, 0, reason);
                                    }
                                });
                            }
                        } else {
                            // 全員失敗の場合
                            const failureFixed = parseFixedOrRoll(rollParts[1]);
                            if (failureFixed >= 0) {
                                // 固定値の場合
                                console.log(`[DEBUG] All failure with fixed value: ${failureFixed}`);
                                setDiceRollRequest(null);
                                processAllCharactersSanCheck(results, 0, failureFixed, reason);
                            } else {
                                // ダイスロールの場合
                                setDiceRollRequest({
                                    notation: rollParts[1],
                                    reason: `失敗時のSAN損失: ${reason}`,
                                    onComplete: (failureLoss) => {
                                        setDiceRollRequest(null);
                                        processAllCharactersSanCheck(results, 0, failureLoss, reason);
                                    }
                                });
                            }
                        }
                    } else {
                        // 単一のダイスロール形式（"1d4"など）
                        const rollFixed = parseFixedOrRoll(roll);
                        if (rollFixed >= 0) {
                            // 固定値の場合
                            console.log(`[DEBUG] Single roll with fixed value: ${rollFixed}`);
                            setDiceRollRequest(null);

                            const results: Array<{ character: Character, sanRoll: number, isSuccess: boolean }> = [];
                            characters.forEach(character => {
                                const currentSan = character.san.current;
                                const isSuccess = sanCheckRoll <= currentSan;
                                results.push({ character, sanRoll: sanCheckRoll, isSuccess });
                            });

                            processAllCharactersSanCheck(results, rollFixed, rollFixed, reason);
                        } else {
                            // ダイスロールの場合
                            setDiceRollRequest({
                                notation: roll,
                                reason: `SAN損失: ${reason}`,
                                onComplete: (sanLoss) => {
                                    setDiceRollRequest(null);

                                    const results: Array<{ character: Character, sanRoll: number, isSuccess: boolean }> = [];
                                    characters.forEach(character => {
                                        const currentSan = character.san.current;
                                        const isSuccess = sanCheckRoll <= currentSan;
                                        results.push({ character, sanRoll: sanCheckRoll, isSuccess });
                                    });

                                    processAllCharactersSanCheck(results, sanLoss, sanLoss, reason);
                                }
                            });
                        }
                    }
                }
            });
            return;
        }

        // 個別キャラクターのSANチェック（既存のロジック）
        const character = characters.find(c => c.id === characterId)!;
        const currentSan = character.san.current;

        // 成功/失敗の判定を行うため、まず1d100を振る
        setDiceRollRequest({
            notation: '1d100',
            reason: `SANチェック: ${reason} (${character.name})`,
            onComplete: (sanRoll) => {
                const isSuccess = sanRoll <= currentSan;
                let sanLossRoll: string;

                // 成功/失敗に応じてSAN損失を分ける（"1/1d6" → 成功時1、失敗時1d6）
                const rollParts = roll.split('/');
                console.log(`[DEBUG] Split "${roll}" into rollParts:`, rollParts);
                console.log(`[DEBUG] rollParts.length:`, rollParts.length);
                if (rollParts.length === 2) {
                    sanLossRoll = isSuccess ? rollParts[0] : rollParts[1];
                    console.log(`[DEBUG] isSuccess:`, isSuccess);
                    console.log(`[DEBUG] Selected rollParts[${isSuccess ? 0 : 1}]:`, rollParts[isSuccess ? 0 : 1]);
                    console.log(`[DEBUG] Selected sanLossRoll:`, sanLossRoll);
                    console.log(`[DEBUG] sanLossRoll type:`, typeof sanLossRoll);
                    console.log(`[DEBUG] sanLossRoll length:`, sanLossRoll.length);
                } else {
                    // 古い形式（"1d4"など）の場合はそのまま使用
                    sanLossRoll = roll;
                    console.log(`[DEBUG] Using single roll format:`, sanLossRoll);
                }

                // 固定値の場合はダイスロールをスキップ
                const fixedSanLoss = parseFixedOrRoll(sanLossRoll);
                console.log(`[DEBUG] parseFixedOrRoll returned:`, fixedSanLoss);
                if (fixedSanLoss >= 0) {
                    console.log(`[DEBUG] Processing as fixed value. SAN loss will be:`, fixedSanLoss);
                    // 固定値の場合は直接処理
                    setDiceRollRequest(null);
                    const newSan = Math.max(0, character.san.current - fixedSanLoss);
                    console.log(`[DEBUG] Character SAN: ${character.san.current} - ${fixedSanLoss} = ${newSan}`);
                    const resultText = isSuccess ? "成功" : "失敗";
                    const comparisonSymbol = isSuccess ? "≤" : ">";

                    // 狂気判定
                    const madnessResult = checkForMadness(character, fixedSanLoss);
                    let madnessMessage = '';
                    if (madnessResult.type) {
                        const madnessTypeText = madnessResult.type === 'temporary' ? '一時的狂気' : '不定の狂気';
                        madnessMessage = `\n- **${madnessTypeText}**: ${madnessResult.description}`;
                        if (madnessResult.duration) {
                            madnessMessage += ` (${madnessResult.duration}ラウンド)`;
                        }
                    }

                    const message = `🧠 **正気度チェック: ${reason} (${character.name})**\n- **判定:** ${sanRoll} ${comparisonSymbol} ${currentSan} → ${resultText}\n- **SAN損失:** ${fixedSanLoss} (${character.san.current} → ${newSan})${madnessMessage}`;

                    updateCharacterState(characterId, c => ({
                        ...c,
                        san: { ...c.san, current: newSan },
                        madness: madnessResult.type ? {
                            type: madnessResult.type,
                            description: madnessResult.description,
                            ...(madnessResult.duration !== undefined ? { duration: madnessResult.duration } : {})
                        } : c.madness
                    }));

                    // SAN値が0以下になった場合は即座にゲームオーバー
                    if (newSan <= 0) {
                        setMessages(prev => [...prev, 
                            { id: `sancheck-result-${Date.now()}`, content: message, sender: MessageSender.System },
                            { id: `gameover-san-${Date.now()}`, content: `### ゲームオーバー\n\n${character.name}の正気度が完全に失われた。もはや元の人格は存在しない...`, sender: MessageSender.System }
                        ]);
                        onGameOver();
                        setIsLoading(false);
                        setPendingAction(null);
                        return;
                    }

                    // SANチェック結果の詳細をAIに送信
                    const actionText = `${character.name}が「${reason}」による正気度チェックを実行した。判定：${sanRoll}（目標値：${currentSan}）→${resultText}。SAN損失：${fixedSanLoss}。${madnessResult.type ? `${madnessResult.type === 'temporary' ? '一時的狂気' : '不定の狂気'}「${madnessResult.description}」が発症。` : '狂気は発症せず。'}`;
                    handleSystemAction(actionText, message);
                } else {
                    // ダイスロールが必要な場合
                    setDiceRollRequest({
                        notation: sanLossRoll,
                        reason: `SAN損失: ${reason} (${character.name})`,
                        onComplete: (sanLoss) => {
                            setDiceRollRequest(null);
                            const newSan = Math.max(0, character.san.current - sanLoss);
                            const resultText = isSuccess ? "成功" : "失敗";
                            const comparisonSymbol = isSuccess ? "≤" : ">";

                            // 狂気判定
                            const madnessResult = checkForMadness(character, sanLoss);
                            let madnessMessage = '';
                            if (madnessResult.type) {
                                const madnessTypeText = madnessResult.type === 'temporary' ? '一時的狂気' : '不定の狂気';
                                madnessMessage = `\n- **${madnessTypeText}**: ${madnessResult.description}`;
                                if (madnessResult.duration) {
                                    madnessMessage += ` (${madnessResult.duration}ラウンド)`;
                                }
                            }

                            const message = `🧠 **正気度チェック: ${reason} (${character.name})**\n- **判定:** ${sanRoll} ${comparisonSymbol} ${currentSan} → ${resultText}\n- **SAN損失:** ${sanLoss} (${character.san.current} → ${newSan})${madnessMessage}`;

                            updateCharacterState(characterId, c => ({
                                ...c,
                                san: { ...c.san, current: newSan },
                                madness: madnessResult.type ? {
                                    type: madnessResult.type,
                                    description: madnessResult.description,
                                    ...(madnessResult.duration !== undefined ? { duration: madnessResult.duration } : {})
                                } : c.madness
                            }));

                            // SAN値が0以下になった場合は即座にゲームオーバー
                            if (newSan <= 0) {
                                setMessages(prev => [...prev, 
                                    { id: `sancheck-result-${Date.now()}`, content: message, sender: MessageSender.System },
                                    { id: `gameover-san-${Date.now()}`, content: `### ゲームオーバー\n\n${character.name}の正気度が完全に失われた。もはや元の人格は存在しない...`, sender: MessageSender.System }
                                ]);
                                onGameOver();
                                setIsLoading(false);
                                setPendingAction(null);
                                return;
                            }

                            // SANチェック結果の詳細をAIに送信
                            const actionText = `${character.name}が「${reason}」による正気度チェックを実行した。判定：${sanRoll}（目標値：${currentSan}）→${resultText}。SAN損失：${sanLoss}。${madnessResult.type ? `${madnessResult.type === 'temporary' ? '一時的狂気' : '不定の狂気'}「${madnessResult.description}」が発症。` : '狂気は発症せず。'}`;
                            handleSystemAction(actionText, message);
                        }
                    });
                }
            }
        });
    };

    const handleGenericDiceRoll = (roll: string, reason: string) => {
        setLastFailedSkillCheck(null);

        // 汎用ダイスロール実行時に一時的狂気のラウンド数を減少
        decrementMadnessDuration();

        setDiceRollRequest({
            notation: roll,
            reason: reason,
            onComplete: (result) => {
                setDiceRollRequest(null);
                const message = `🎲 **ダイスロール: ${reason}**\n- **結果:** ${roll} → ${result}`;
                handleSystemAction(`${reason} の結果、${result} が出た。`, message);
            }
        });
    };

    const hasPendingChoice = !!(pendingAction?.skillCheck || pendingAction?.statCheck || pendingAction?.sanityCheck || pendingAction?.diceRollRequired);

    return (
        <div className="h-screen w-screen flex bg-gray-900 text-gray-200 font-sans bg-cover bg-center" style={{ backgroundImage: "url('https://images.unsplash.com/photo-1531685250784-7569952593d2?q=80&w=1920&auto=format&fit=crop')" }}>
            {diceRollRequest && (
                <DiceRollModal
                    isOpen={true}
                    notation={diceRollRequest.notation}
                    reason={diceRollRequest.reason}
                    onRollComplete={diceRollRequest.onComplete}
                />
            )}
            {modalAction && (
                <ActionModal
                    characters={characters}
                    action={modalAction}
                    onClose={() => setModalAction(null)}
                    onSelect={(charId) => {
                        if (modalAction.type === 'skill') {
                            handleSkillCheck(modalAction.skill, charId);
                        } else if (modalAction.type === 'stat') {
                            handleStatCheck(modalAction.stat, modalAction.multiplier, modalAction.reason, charId);
                        } else {
                            handleSanityCheck(modalAction.roll, modalAction.reason, charId);
                        }
                        setModalAction(null);
                    }}
                />
            )}
            <div className="absolute inset-0 bg-black/70 backdrop-blur-sm"></div>

            {isSidebarOpen && <div className="fixed inset-0 bg-black/50 z-20 md:hidden" onClick={() => setIsSidebarOpen(false)}></div>}

            <aside className={`fixed md:static inset-y-0 left-0 w-4/5 sm:w-2/3 md:w-1/3 xl:w-1/4 h-full bg-gray-900/90 backdrop-blur-md overflow-y-auto border-r border-purple-500/20 z-30 transform transition-transform duration-300 ease-in-out ${isSidebarOpen ? 'translate-x-0' : '-translate-x-full'} md:translate-x-0`}>
                <CharacterStatus characters={characters} onCharacterUpdate={setCharacters} onClose={() => setIsSidebarOpen(false)} />
            </aside>

            <main className="w-full h-full flex flex-col z-10">
                <header className="md:hidden p-2 border-b border-purple-500/20 flex items-center bg-gray-900/70 backdrop-blur-sm sticky top-0">
                    <button onClick={() => setIsSidebarOpen(true)} className="p-2 text-gray-300 hover:text-white" aria-label="探索者ステータスを開く">
                        <Users size={24} />
                    </button>
                    <h1 className="text-center font-crimson text-lg text-purple-200 flex-grow mr-10">Auto TRPG</h1>
                </header>
                <div className="flex-1 overflow-y-auto p-2 sm:p-6">
                    <div className="max-w-4xl mx-auto">
                        {messages.map((msg) => <ChatMessage key={msg.id} message={msg} />)}
                        {isLoading && (
                            <div className="flex justify-center items-center gap-3 text-gray-400 py-4">
                                <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-purple-400"></div>
                                <span className="font-semibold text-lg">思考中...</span>
                            </div>
                        )}
                        <div ref={chatEndRef}></div>
                    </div>
                </div>

                <div className="p-2 sm:p-6 border-t border-purple-500/20 bg-gray-900/70 backdrop-blur-sm sticky bottom-0">
                    <div className="max-w-4xl mx-auto">
                        {lastFailedSkillCheck && !isLoading && (
                            <div className="mb-4 text-center">
                                <div className="p-3 bg-red-900/50 border border-red-700/50 rounded-lg shadow-md mb-3">
                                    <p className="text-yellow-200 italic mb-2">判定に失敗しました。この判定を「プッシュ」して、大きなリスクと引き換えに再挑戦しますか？</p>
                                    <p className="text-sm text-gray-400">失敗すると、ただの失敗よりも悪い結果が訪れます。</p>
                                </div>
                                <div className="flex justify-center items-center gap-4">
                                    <button
                                        onClick={handleDeclinePushRoll}
                                        className="px-6 py-2 bg-gray-600 hover:bg-gray-500 text-white font-bold rounded-lg transition-colors shadow-lg"
                                    >
                                        諦める
                                    </button>
                                    <button
                                        onClick={handlePushRoll}
                                        className="px-6 py-2 bg-red-700 hover:bg-red-600 text-white font-bold rounded-lg transition-colors transform hover:scale-105 shadow-lg flex items-center justify-center"
                                    >
                                        <AlertTriangle className="mr-2" size={18} />
                                        プッシュ・ロールを実行
                                    </button>
                                </div>
                            </div>
                        )}

                        {pendingAction && !isLoading && (
                            <div className="flex flex-col sm:flex-row flex-wrap justify-center gap-3 mb-4">
                                {pendingAction.skillCheck && (
                                    <button onClick={() => setModalAction({ type: 'skill', skill: pendingAction.skillCheck! })} className={actionButtonClasses}>
                                        <BrainCircuit className="mr-2" size={18} />
                                        〈{pendingAction.skillCheck}〉で技能判定
                                    </button>
                                )}
                                {pendingAction.statCheck && (
                                    <button onClick={() => setModalAction({ type: 'stat', ...pendingAction.statCheck! })} className={actionButtonClasses}>
                                        <BrainCircuit className="mr-2" size={18} />
                                        {pendingAction.statCheck.reason} ({pendingAction.statCheck.stat}×{pendingAction.statCheck.multiplier || 5})
                                    </button>
                                )}
                                {pendingAction.sanityCheck && (
                                    <button onClick={() => setModalAction({ type: 'sanity', ...pendingAction.sanityCheck! })} className={actionButtonClasses}>
                                        <BrainCircuit className="mr-2" size={18} />
                                        正気度チェック ({pendingAction.sanityCheck.roll})
                                    </button>
                                )}
                                {pendingAction.diceRollRequired && (
                                    <button onClick={() => handleGenericDiceRoll(pendingAction.diceRollRequired!.roll, pendingAction.diceRollRequired!.reason)} className={actionButtonClasses}>
                                        <Dices className="mr-2" size={18} />
                                        {pendingAction.diceRollRequired.roll} を振る
                                    </button>
                                )}
                            </div>
                        )}

                        {pendingAction?.suggestedActions && !hasPendingChoice && !isLoading && (
                            <div className="flex flex-col sm:flex-row flex-wrap justify-center gap-3 mb-4">
                                {pendingAction.suggestedActions.map((action, index) => (
                                    <button key={index} onClick={() => handleSuggestedActionClick(action)} className={actionButtonClasses}>
                                        <HelpCircle className="mr-2" size={18} />
                                        {action}
                                    </button>
                                ))}
                            </div>
                        )}

                        <form onSubmit={handleSubmit} className="flex gap-3">
                            <input
                                type="text"
                                value={input}
                                onChange={(e) => setInput(e.target.value)}
                                placeholder={isLoading ? "AIが応答を生成中です..." : "あなたの行動を入力..."}
                                disabled={isLoading || hasPendingChoice}
                                className="flex-grow p-3 bg-gray-800 border border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-400 placeholder-gray-500 disabled:bg-gray-700 disabled:cursor-not-allowed"
                                aria-label="プレイヤーの行動入力"
                            />
                            <button
                                type="submit"
                                disabled={isLoading || hasPendingChoice || !input.trim()}
                                className="px-6 py-3 bg-purple-600 text-white font-bold rounded-lg hover:bg-purple-700 disabled:bg-gray-600 disabled:cursor-not-allowed transition-colors flex items-center justify-center"
                                aria-label="行動を送信"
                            >
                                <Send size={20} />
                            </button>
                        </form>
                    </div>
                </div>
            </main>
        </div>
    );
};
