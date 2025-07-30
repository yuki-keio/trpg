
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
          | { type: 'sanity', roll: string, reason: string }
          | { type: 'stat', stat: keyof Character['stats'], multiplier?: number, reason: string };
    onClose: () => void;
    onSelect: (characterId: string) => void;
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
                    <button onClick={onClose} className="text-gray-400 hover:text-white"><X size={24}/></button>
                </div>
                <p className="text-gray-300 mb-6">{subtitle}</p>
                <div className="space-y-3">
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

    const processKeeperResponse = useCallback((response: KeeperResponse) => {
        setMessages(prev => [...prev, { id: `keeper-${Date.now()}-${prev.length}`, content: response.description, sender: MessageSender.Keeper }]);
        
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
        
        setLastFailedSkillCheck(null);
        setMessages(prev => [...prev, { id: `player-${Date.now()}-${prev.length}`, content: actionText, sender: MessageSender.Player }]);
        setIsLoading(true);
        setPendingAction(null);
        setInput('');

        const response = await sendPlayerAction(chatSession, actionText, characters, rollResult);
        processKeeperResponse(response);
    }, [characters, processKeeperResponse, chatSession]);
    
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
    }, [characters, chatSession, processKeeperResponse]);

    const handleStatCheck = useCallback((stat: keyof Character['stats'], multiplier: number = 5, reason: string, characterId: string) => {
        setPendingAction(null);
        setLastFailedSkillCheck(null);

        const character = characters.find(c => c.id === characterId)!;
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
    }, [characters, chatSession, processKeeperResponse]);

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


    const handleSanityCheck = (roll: string, reason: string, characterId: string) => {
        setLastFailedSkillCheck(null);
        const character = characters.find(c => c.id === characterId)!;
        
        setDiceRollRequest({
            notation: roll,
            reason: `SANチェック: ${reason}`,
            onComplete: (sanLoss) => {
                setDiceRollRequest(null);
                const newSan = Math.max(0, character.san.current - sanLoss);
                const message = `🧠 **正気度チェック: ${reason} (${character.name})**\n- **SAN損失:** ${sanLoss} (${character.san.current} → ${newSan})`;
                
                updateCharacterState(characterId, c => ({ ...c, san: { ...c.san, current: newSan }}));
                
                handleSystemAction(`${character.name}が正気度チェックに失敗し、SANを${sanLoss}失った。`, message);
            }
        });
    };
    
    const handleGenericDiceRoll = (roll: string, reason: string) => {
        setLastFailedSkillCheck(null);
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
        <div className="h-screen w-screen flex bg-gray-900 text-gray-200 font-sans bg-cover bg-center" style={{backgroundImage: "url('https://images.unsplash.com/photo-1531685250784-7569952593d2?q=80&w=1920&auto=format&fit=crop')"}}>
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
