
import React, { useState, useEffect } from 'react';
import type { Character } from '../types';
import { HeartPulse, BrainCircuit, Users, X, User, Sword, Shield, BookOpen } from 'lucide-react';

const StatBar: React.FC<{ value: number; max: number; label: string; icon: React.ReactNode; color: string }> = ({ value, max, label, icon, color }) => {
  const percentage = max > 0 ? (value / max) * 100 : 0;
  return (
    <div className="mb-3">
      <div className="flex justify-between items-center mb-1 text-sm font-bold">
        <div className="flex items-center">
          {icon}
          <span className="ml-2">{label}</span>
        </div>
        <span className="font-crimson">{value} / {max}</span>
      </div>
      <div className="w-full bg-gray-700 rounded-full h-2.5">
        <div className={`${color} h-2.5 rounded-full transition-all duration-300`} style={{ width: `${percentage}%` }}></div>
      </div>
    </div>
  );
};

const SkillItem: React.FC<{ name: string; value: number }> = ({ name, value }) => (
    <div className="flex justify-between items-center text-sm py-1 border-b border-gray-700/50">
        <span>〈{name}〉</span>
        <span className="font-bold font-crimson">{value}</span>
    </div>
);

const CharacterDetails: React.FC<{ character: Character }> = ({ character }) => {
    return (
        <div>
            <div className="flex flex-col items-center w-full">
                {character.iconUrl ? (
                    <img src={character.iconUrl} alt={character.name} className="w-24 h-24 rounded-full object-cover mb-4 border-2 border-purple-400/50 shadow-lg" />
                ) : (
                    <div className="w-24 h-24 rounded-full bg-gray-700 flex items-center justify-center mb-4 border-2 border-purple-400/50 shadow-lg">
                        <User size={50} />
                    </div>
                )}
                <h2 className="text-2xl font-bold text-center mb-1 font-crimson text-purple-300">{character.name}</h2>
                <p className="text-center text-purple-200/80 mb-4 text-sm font-semibold">{character.occupation || '職業未設定'}</p>
            </div>
            
            <div className="bg-gray-800/50 rounded-lg p-4 mb-4">
                <StatBar label="HP" value={character.hp.current} max={character.hp.max} icon={<HeartPulse size={16} />} color="bg-red-600" />
                <StatBar label="MP" value={character.mp.current} max={character.mp.max} icon={<BookOpen size={16} />} color="bg-green-500" />
                <StatBar label="SAN" value={character.san.current} max={character.san.max} icon={<BrainCircuit size={16} />} color="bg-blue-500" />
            </div>
            
            {character.description && (
                <details className="mb-4 bg-gray-800/50 rounded-lg">
                    <summary className="p-3 cursor-pointer font-bold text-purple-200">背景・所持品</summary>
                    <div className="p-3 border-t border-gray-700">
                        <blockquote className="text-gray-300 text-sm whitespace-pre-wrap">
                            {character.description}
                        </blockquote>
                    </div>
                </details>
            )}

            <div className="bg-gray-800/50 rounded-lg p-4 mb-4">
                <h3 className="text-lg font-bold mb-2 font-crimson text-purple-300">能力値</h3>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-1 text-sm">
                    {Object.entries(character.stats).map(([key, value]) => (
                        <div key={key} className="flex justify-between">
                            <span className="font-bold">{key}</span>
                            <span className="font-crimson">{value}</span>
                        </div>
                    ))}
                </div>
            </div>

            <div className="bg-gray-800/50 rounded-lg p-4 mb-4">
                <h3 className="text-lg font-bold mb-2 font-crimson text-purple-300">装備</h3>
                <div className="mb-3">
                    <h4 className="font-bold mb-1 text-purple-200/80 flex items-center"><Sword size={16} className="mr-2"/>武器</h4>
                    {character.weapons.length > 0 ? (
                        <ul className="text-sm space-y-1 pl-2">
                            {character.weapons.map(w => (
                                <li key={w.id} className="border-b border-gray-700/30 pb-1">
                                    <div className="font-semibold">{w.name}</div>
                                    <div className="text-xs text-gray-400 pl-2">
                                       ダメージ: {w.damage}
                                       {w.ammoCapacity !== null && `, 装弾数: ${w.currentAmmo}/${w.ammoCapacity}`}
                                       {w.durability !== null && `, 耐久力: ${w.durability}`}
                                    </div>
                                </li>
                            ))}
                        </ul>
                    ) : <p className="text-sm text-gray-400 italic pl-2">なし</p>}
                </div>
                 <div>
                    <h4 className="font-bold mb-1 text-purple-200/80 flex items-center"><Shield size={16} className="mr-2"/>防具</h4>
                    {character.armor.length > 0 ? (
                        <ul className="text-sm space-y-1 pl-2">
                            {character.armor.map(a => (
                                <li key={a.id} className="border-b border-gray-700/30 pb-1">
                                    <span className="font-semibold">{a.name}</span> <span className="text-xs text-gray-400">(装甲: {a.armorValue})</span>
                                </li>
                            ))}
                        </ul>
                    ) : <p className="text-sm text-gray-400 italic pl-2">なし</p>}
                </div>
            </div>

            <div className="bg-gray-800/50 rounded-lg p-4">
                <h3 className="text-lg font-bold mb-2 font-crimson text-purple-300">技能</h3>
                <div className="max-h-60 overflow-y-auto pr-2">
                    {Object.entries(character.skills)
                        .filter(([, value]) => value > 0)
                        .sort(([a], [b]) => a.localeCompare(b, 'ja'))
                        .map(([skill, value]) => (
                            <SkillItem key={skill} name={skill} value={value} />
                        ))}
                </div>
            </div>
        </div>
    );
};


export const CharacterStatus: React.FC<{ characters: Character[]; onCharacterUpdate: (characters: Character[]) => void; onClose?: () => void; }> = ({ characters, onClose }) => {
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    if (characters.length > 0 && !selectedId) {
      setSelectedId(characters[0].id);
    }
     if (selectedId && !characters.find(c => c.id === selectedId)) {
        setSelectedId(characters.length > 0 ? characters[0].id : null);
    }
  }, [characters, selectedId]);

  const selectedCharacter = characters.find(c => c.id === selectedId);

  return (
    <div className="text-gray-300 p-2">
        <div className="flex justify-between items-center mb-4">
            <h2 className="text-xl font-bold font-crimson text-purple-200 flex items-center"><Users className="mr-2"/>探索者パーティー</h2>
            {onClose && (
                <button onClick={onClose} className="md:hidden text-gray-400 hover:text-white p-1" aria-label="閉じる">
                    <X size={24} />
                </button>
            )}
        </div>
        <div className="space-y-2 mb-4">
            {characters.map(char => (
                 <button key={char.id} onClick={() => setSelectedId(char.id)}
                    className={`w-full text-left p-3 rounded-md cursor-pointer transition-colors flex items-center ${selectedId === char.id ? 'bg-purple-800/60' : 'bg-gray-800/70 hover:bg-gray-700/70'}`}>
                    {char.iconUrl ? (
                        <img src={char.iconUrl} alt={char.name} className="w-10 h-10 rounded-full object-cover mr-3 flex-shrink-0" />
                    ) : (
                        <div className="w-10 h-10 rounded-full bg-gray-700 flex items-center justify-center mr-3 flex-shrink-0">
                            <User size={22} />
                        </div>
                    )}
                    <div className="flex-grow overflow-hidden">
                        <div className="font-semibold truncate">{char.name}</div>
                        <div className="flex justify-between text-xs mt-1 text-gray-400">
                            <span>HP: {char.hp.current}/{char.hp.max}</span>
                            <span>MP: {char.mp.current}/{char.mp.max}</span>
                            <span>SAN: {char.san.current}/{char.san.max}</span>
                        </div>
                    </div>
                 </button>
            ))}
        </div>
        <hr className="border-purple-500/20 my-4" />
        {selectedCharacter ? (
            <CharacterDetails character={selectedCharacter} />
        ) : (
            <p>キャラクターがいません。</p>
        )}
    </div>
  );
};