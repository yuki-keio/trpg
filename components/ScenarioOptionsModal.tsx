
import React, { useState } from 'react';
import { X, Clock, BarChartBig, ScrollText, Wand2, BrainCircuit } from 'lucide-react';

interface ScenarioOptionsModalProps {
    isOpen: boolean;
    onClose: () => void;
    onGenerate: (options: { playTime?: string; difficulty?: string; synopsis?: string; }) => void;
}

const RadioOption = ({ name, value, label, description, checked, onChange, icon }: { name: string, value: string, label: string, description: string, checked: boolean, onChange: (e: React.ChangeEvent<HTMLInputElement>) => void, icon: React.ReactNode }) => (
    <label className={`flex items-center p-3 rounded-lg border-2 cursor-pointer transition-all ${checked ? 'border-purple-500 bg-purple-900/40' : 'border-gray-700 bg-gray-800 hover:border-gray-600'}`}>
        <input type="radio" name={name} value={value} checked={checked} onChange={onChange} className="hidden" />
        <div className={`mr-4 p-2 rounded-full ${checked ? 'bg-purple-500' : 'bg-gray-600'}`}>
            {icon}
        </div>
        <div>
            <p className="font-semibold text-gray-200">{label}</p>
            <p className="text-sm text-gray-400">{description}</p>
        </div>
    </label>
);

export const ScenarioOptionsModal: React.FC<ScenarioOptionsModalProps> = ({ isOpen, onClose, onGenerate }) => {
    const [playTime, setPlayTime] = useState('');
    const [difficulty, setDifficulty] = useState('');
    const [synopsis, setSynopsis] = useState('');

    if (!isOpen) {
        return null;
    }

    const handleGenerateWithSettings = () => {
        onGenerate({ playTime, difficulty, synopsis });
    };

    const handleGenerateRandomly = () => {
        onGenerate({});
    };

    return (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-2 sm:p-4" onClick={onClose}>
            <div
                className="bg-gray-800 rounded-lg shadow-xl border border-purple-500/30 w-full max-w-3xl animate-fade-in flex flex-col max-h-[90vh]"
                style={{ maxHeight: '90vh' }}
                onClick={e => e.stopPropagation()}
            >
                <div className="p-6 overflow-y-auto flex-1 min-h-0">
                    <div className="flex justify-between items-start mb-6">
                        <h2 className="text-3xl font-bold font-crimson text-purple-300">シナリオ設定</h2>
                        <button type="button" onClick={onClose} className="text-gray-400 hover:text-white"><X size={28} /></button>
                    </div>
                    <p className="text-gray-400 mb-6">生成するシナリオの要望を指定できます。空欄のままでも構いません。</p>

                    <div className="space-y-6">
                        {/* Play Time */}
                        <div>
                            <h3 className="text-lg font-semibold text-purple-200 mb-3 flex items-center"><Clock size={20} className="mr-2" />プレイ時間</h3>
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                                <RadioOption name="playTime" value="ショート (1～2時間)" label="ショート" description="1～2時間" checked={playTime === 'ショート (1～2時間)'} onChange={(e) => setPlayTime(e.target.value)} icon={<Clock size={20} />} />
                                <RadioOption name="playTime" value="ミドル (3～4時間)" label="ミドル" description="3～4時間" checked={playTime === 'ミドル (3～4時間)'} onChange={(e) => setPlayTime(e.target.value)} icon={<Clock size={20} />} />
                                <RadioOption name="playTime" value="ロング (5時間以上)" label="ロング" description="5時間以上" checked={playTime === 'ロング (5時間以上)'} onChange={(e) => setPlayTime(e.target.value)} icon={<Clock size={20} />} />
                            </div>
                        </div>

                        {/* Difficulty */}
                        <div>
                            <h3 className="text-lg font-semibold text-purple-200 mb-3 flex items-center"><BarChartBig size={20} className="mr-2" />難易度</h3>
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                                <RadioOption name="difficulty" value="低 (探索や謎解きが中心。戦闘は少なめ)" label="低" description="初心者向け" checked={difficulty === '低 (探索や謎解きが中心。戦闘は少なめ)'} onChange={(e) => setDifficulty(e.target.value)} icon={<BarChartBig size={20} />} />
                                <RadioOption name="difficulty" value="中 (バランスの取れた標準的な難易度)" label="中" description="標準" checked={difficulty === '中 (バランスの取れた標準的な難易度)'} onChange={(e) => setDifficulty(e.target.value)} icon={<BarChartBig size={20} />} />
                                <RadioOption name="difficulty" value="高 (戦闘やSANチェックが多く、ロストの危険性が高い)" label="高" description="挑戦的" checked={difficulty === '高 (戦闘やSANチェックが多く、ロストの危険性が高い)'} onChange={(e) => setDifficulty(e.target.value)} icon={<BarChartBig size={20} />} />
                            </div>
                        </div>

                        {/* Synopsis */}
                        <div>
                            <h3 className="text-lg font-semibold text-purple-200 mb-3 flex items-center"><ScrollText size={20} className="mr-2" />あらすじや設定など</h3>
                            <textarea
                                value={synopsis}
                                onChange={(e) => setSynopsis(e.target.value)}
                                placeholder="例：古い灯台に隠された秘密を探る、失踪した考古学者を追って禁断の遺跡へ..."
                                className="w-full p-3 bg-gray-700 border border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-purple-400 h-24 resize-y text-gray-200"
                            />
                        </div>
                    </div>
                </div>

                <div className="bg-gray-900/50 px-6 py-4 flex flex-col sm:flex-row justify-end gap-4 rounded-b-lg sticky bottom-0 z-10">
                    <button onClick={handleGenerateRandomly} className="px-6 py-3 bg-gray-600 hover:bg-gray-500 text-white font-semibold rounded-md transition-colors flex items-center justify-center text-lg">
                        <Wand2 className="mr-2" />
                        おまかせで生成
                    </button>
                    <button onClick={handleGenerateWithSettings} className="px-6 py-3 bg-purple-600 hover:bg-purple-500 text-white font-semibold rounded-md transition-colors flex items-center justify-center text-lg">
                        <BrainCircuit className="mr-2" />
                        この設定で物語を始める
                    </button>
                </div>
                <style>{`
                    @keyframes fade-in {
                        from { opacity: 0; transform: translateY(10px); }
                        to { opacity: 1; transform: translateY(0); }
                    }
                    .animate-fade-in {
                        animation: fade-in 0.3s ease-out forwards;
                    }
                `}</style>
            </div>
        </div>
    );
};
