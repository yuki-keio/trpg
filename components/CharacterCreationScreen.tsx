
import React from 'react';
import { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import type { Character, Weapon, Armor, CustomSkill } from '../types';
import { INITIAL_SKILLS, OCCUPATIONS, SKILL_CATEGORIES, DYNAMIC_BASE_SKILLS, ALL_SKILLS } from '../constants';
import { UserPlus, Trash2, Users, UploadCloud, X, User, Sword, Shield, Pencil, PlusCircle, BrainCircuit, Dices, Info, ChevronsUpDown, RotateCcw, Sparkles } from 'lucide-react';
import { parseAndRoll } from '../utils/dice';
import { generateCharacterBackground } from '../services/keeperAI';

// Type for skill point allocations
type SkillAllocation = { occ: number; int: number };
type CharacterAllocations = { [skillName: string]: SkillAllocation };
type AllAllocations = { [characterId: string]: CharacterAllocations };

const createNewCharacter = (): Character => {
    const defaultRawStats = { STR: 10, CON: 10, POW: 10, DEX: 10, APP: 10, SIZ: 10, INT: 10, EDU: 10 };
    return {
        id: Date.now().toString() + Math.random().toString(36).substring(2),
        name: '無名の探索者',
        occupation: '',
        description: '',
        iconUrl: '',
        stats: defaultRawStats,
        hp: { current: 10, max: 10 },
        mp: { current: 10, max: 10 },
        san: { current: 50, max: 50 },
        skills: {},
        customOccupationalSkills: [],
        customSkills: [],
        weapons: [],
        armor: [],
        madness: { type: null, description: '', duration: 0 },
    };
};

const calculateDamageBonus = (str: number, siz: number): string => {
    const sum = str + siz;
    if (sum <= 12) return "-1D6";
    if (sum <= 16) return "-1D4";
    if (sum <= 24) return "+0";
    if (sum <= 32) return "+1D4";
    if (sum <= 40) return "+1D6";
    if (sum <= 56) return "+2D6";
    if (sum <= 72) return "+3D6";
    return "+4D6";
};

const getBaseSkillValue = (skillName: string, stats: Character['stats'], customSkills: CustomSkill[] = []): number => {
    const dynamicCalc = DYNAMIC_BASE_SKILLS[skillName as keyof typeof DYNAMIC_BASE_SKILLS];
    if (dynamicCalc) {
        return dynamicCalc(stats);
    }
    
    // 独自技能をチェック
    const customSkill = customSkills.find(skill => skill.name === skillName);
    if (customSkill) {
        return customSkill.baseValue;
    }
    
    return INITIAL_SKILLS[skillName] ?? 0;
};

const getStatRollNotation = (statName: keyof Character['stats']): string => {
    switch (statName) {
        case 'SIZ':
        case 'INT':
            return '2d6+6';
        case 'EDU':
            return '3d6+3';
        case 'STR':
        case 'CON':
        case 'POW':
        case 'DEX':
        case 'APP':
        default:
            return '3d6';
    }
};

const parseIacharaText = (text: string): { character: Character; allocations: CharacterAllocations } => {
    const newChar = createNewCharacter();
    const newAllocations: CharacterAllocations = {};
    const rawStats: { [key: string]: any } = {};

    const getSection = (title: string, content: string): string => {
        const regex = new RegExp(`【${title}】([\\s\\S]*?)(?:【|$)`);
        const match = content.match(regex);
        return match ? match[1].trim() : '';
    };

    // 1. Basic Info
    const basicInfo = getSection('基本情報', text);
    newChar.name = basicInfo.match(/名前:\s*(.*?)\s*(?:\(|【)/)?.[1].trim() || '名称不明';
    newChar.occupation = basicInfo.match(/職業:\s*(.*?)(?:\n|$)/)?.[1].trim() || '';

    // 2. Icon
    const iconInfo = getSection('アイコン', text);
    newChar.iconUrl = iconInfo.match(/https?:\/\/[^\s]+/)?.[0] || '';

    // 3. Stats
    const statsInfo = getSection('能力値', text);
    const statRegex = /^(STR|CON|POW|DEX|APP|SIZ|INT|EDU)\s+\d+\s+(\d+)/gm;
    let match;
    while ((match = statRegex.exec(statsInfo)) !== null) {
        const statName = match[1] as keyof Character['stats'];
        const statValue = parseInt(match[2], 10);
        (newChar.stats as any)[statName] = statValue;
        rawStats[statName] = statValue;
    }

    // 4. Skills (Parse this first to get allocations)
    const skillsInfo = getSection('技能値', text);
    for (const skill of ALL_SKILLS) {
        newAllocations[skill] = { occ: 0, int: 0 };
    }

    const skillLines = skillsInfo.split('\n');
    const customSkills: CustomSkill[] = [];
    
    // 現在のカテゴリを追跡
    let currentCategory = '知識技能'; // デフォルト
    
    for (const line of skillLines) {
        // カテゴリ見出しをチェック
        const categoryMatch = line.match(/『(.+?)技能』/);
        if (categoryMatch) {
            currentCategory = categoryMatch[1] + '技能';
            continue;
        }
        
        // Quick filter for lines that are likely not skill entries (e.g., headers)
        if (!/\d/.test(line)) continue;

        const parts = line.trim().split(/\s+/).filter(Boolean);
        if (parts.length < 7) continue; // Expect Name (can be multiple parts) + 6 numbers

        const numericParts = parts.slice(-6);
        if (numericParts.some(p => isNaN(parseInt(p, 10)))) {
            continue; // The last 6 parts must be numbers
        }

        const nameParts = parts.slice(0, -6);
        if (nameParts.length === 0) continue;

        const rawName = nameParts.join(' ');
        const skillName = rawName.split(/[(（]/)[0].trim();

        // 職業P is the 3rd value (index 2), 興味P is the 4th (index 3)
        const occP = parseInt(numericParts[2], 10) || 0;
        const intP = parseInt(numericParts[3], 10) || 0;
        const initialValue = parseInt(numericParts[0], 10) || 0; // 初期値

        if (ALL_SKILLS.includes(skillName)) {
            newAllocations[skillName] = { occ: occP, int: intP };
        } else {
            // 独自技能として追加（現在のセクションのカテゴリを使用）
            const customSkill: CustomSkill = {
                id: `custom_${skillName.replace(/\s/g, '')}_${Date.now()}`,
                name: skillName,
                baseValue: initialValue - occP - intP, // 初期値からポイント分を引いたベース値
                category: currentCategory
            };
            customSkills.push(customSkill);
            newAllocations[skillName] = { occ: occP, int: intP };
        }
    }
    
    newChar.customSkills = customSkills;

    const isPresetOccupation = Object.keys(OCCUPATIONS).includes(newChar.occupation);
    if (!isPresetOccupation && newChar.occupation) {
        newChar.customOccupationalSkills = Object.entries(newAllocations)
            .filter(([, alloc]) => alloc.occ > 0)
            .map(([skillName]) => skillName);
    }


    // 5. Finalize stat-derived values (HP, MP, SAN)
    const hp = Math.ceil(((rawStats.CON ?? 0) + (rawStats.SIZ ?? 0)) / 2);
    newChar.hp = { max: hp, current: hp };
    const hpMatch = statsInfo.match(/HP\s+(\d+)/);
    if (hpMatch) newChar.hp.current = parseInt(hpMatch[1], 10);

    const pow = rawStats.POW ?? 0;
    newChar.mp = { max: pow, current: pow };
    const mpMatch = statsInfo.match(/MP\s+(\d+)/);
    if (mpMatch) newChar.mp.current = parseInt(mpMatch[1], 10);

    const sanMax = pow * 5;
    newChar.san.max = sanMax;
    let currentSan = sanMax;
    const sanMatch = statsInfo.match(/現在SAN値\s*(\d+)/) ?? statsInfo.match(/SAN\s+(\d+)/);
    if (sanMatch) {
        currentSan = parseInt(sanMatch[1], 10);
    }
    newChar.san.current = Math.min(currentSan, sanMax);

    // 6. Finalize skill totals
    const allSkillNames = [...ALL_SKILLS, ...customSkills.map(cs => cs.name)];
    for (const skillName of allSkillNames) {
        const baseValue = getBaseSkillValue(skillName, newChar.stats, customSkills);
        const alloc = newAllocations[skillName] || { occ: 0, int: 0 };
        const total = baseValue + alloc.occ + alloc.int;
        newChar.skills[skillName] = total > 99 ? 99 : total;
    }

    // 7. Combat, Equipment & Memo
    const combatInfo = getSection('戦闘・武器・防具', text);
    const memoInfo = getSection('メモ', text);
    const belongingsInfo = getSection('所持品', text);

    const combatSectionLines = combatInfo.split('\n');
    const headerLine = combatSectionLines.find(line => line.includes('名前') && line.includes('成功率'));

    if (headerLine) {
        const headerLabels = ['名前', '成功率', 'ダメージ', '射程', '攻撃回数', '装弾数', '耐久力', '故障その他'];

        const getWidth = (c: string): number => c.charCodeAt(0) > 255 ? 2 : 1;

        // Step A: Dynamically get "logical column widths" from the header.
        const boundary: number[] = [];
        let displayWidth = 0;
        for (let i = 0; i < headerLine.length; i++) {
            if (headerLabels.some(l => headerLine.startsWith(l, i))) {
                boundary.push(displayWidth);
            }
            displayWidth += getWidth(headerLine[i]);
        }
        boundary.push(Infinity);

        // Step B: Slice each line based on display width.
        const sliceByDisplayWidth = (line: string, boundaries: number[]): string[] => {
            const w = (c: string): number => c.charCodeAt(0) > 255 ? 2 : 1;
            const cells: string[] = [];

            // Create an array of the starting display width for each character in the line.
            const charStartWidths: number[] = [];
            let currentWidth = 0;
            for (const char of line) {
                charStartWidths.push(currentWidth);
                currentWidth += w(char);
            }

            let lastCharIndex = 0;
            // Iterate through the column boundaries to slice the line.
            for (let i = 1; i < boundaries.length; i++) {
                const boundaryWidth = boundaries[i];
                let sliceEndIndex = line.length;

                if (boundaryWidth !== Infinity) {
                    const foundIndex = charStartWidths.findIndex(startW => startW >= boundaryWidth);
                    sliceEndIndex = (foundIndex !== -1) ? foundIndex : line.length;
                }

                // If we're not at the end of the line and the boundary is in the middle of a word
                if (sliceEndIndex > 0 && sliceEndIndex < line.length) {
                    const prevChar = line[sliceEndIndex - 1];
                    const currentChar = line[sliceEndIndex];
                    if (prevChar && !/\s/.test(prevChar) && currentChar && !/\s/.test(currentChar)) {
                        // Extend the slice to the end of the current word.
                        let endOfWord = sliceEndIndex;
                        while (endOfWord < line.length && !/\s/.test(line[endOfWord])) {
                            endOfWord++;
                        }
                        sliceEndIndex = endOfWord;
                    }
                }

                const cell = line.substring(lastCharIndex, sliceEndIndex);
                cells.push(cell.trim());

                lastCharIndex = sliceEndIndex;

                if (lastCharIndex >= line.length) {
                    break;
                }
            }

            while (cells.length < headerLabels.length) {
                cells.push('');
            }
            return cells.slice(0, headerLabels.length);
        };

        const itemLines = combatSectionLines.slice(combatSectionLines.indexOf(headerLine) + 1).filter(line => line.trim() && !line.includes('─'));

        for (const line of itemLines) {
            const [name, , damage, range, attacks, ammo, durability, notes] = sliceByDisplayWidth(line, boundary);

            if (!name) continue;

            const isWeapon = !!damage;
            const isArmor = !isWeapon && (parseInt(durability, 10) > 0 || /鎧|盾|ベスト|チョッキ|防|アーマー|防具/i.test(name));

            if (isWeapon) {
                let malfunction: number | null = null;
                let weaponNotes: string = notes;

                // "故障その他"欄をパースする。"100 サプレッサー装着" のような形式を想定。
                const leadingNumberMatch = weaponNotes.match(/^\s*(\d+)\b(.*)/);

                if (leadingNumberMatch) {
                    malfunction = parseInt(leadingNumberMatch[1], 10);
                    weaponNotes = leadingNumberMatch[2].trim();
                } else {
                    // 先頭に数字がない場合、キーワード（故障など）をチェックする
                    const keywordMatch = weaponNotes.match(/(?:故障|故障ナンバー|FN)\s*[:：]?\s*(\d+)/);
                    if (keywordMatch) {
                        malfunction = parseInt(keywordMatch[1], 10);
                        // この場合、文脈を保持するため備考は元の文字列のままにする
                    }
                }

                const newWeapon: Weapon = {
                    id: `imported_w_${name.replace(/\s/g, '')}_${Date.now()}`,
                    name,
                    damage: damage || '',
                    range: range || '',
                    attacksPerRound: parseInt(attacks, 10) || 1,
                    ammoCapacity: ammo ? parseInt(ammo, 10) : null,
                    currentAmmo: ammo ? parseInt(ammo, 10) : null,
                    durability: durability ? parseInt(durability, 10) : null,
                    malfunction: malfunction,
                    notes: weaponNotes,
                };
                newChar.weapons.push(newWeapon);
            } else if (isArmor) {
                let armorValue = parseInt(durability, 10) || 0;

                const armorRegex = /(\d+)(?:点軽減|ダメージ軽減|装甲)/i;
                const notesMatch = notes.match(armorRegex);
                if (notesMatch && notesMatch[1]) {
                    armorValue = parseInt(notesMatch[1], 10);
                } else if (armorValue === 0) {
                    const memoArmorRegex = new RegExp(`${name}.*?(?:ダメージ-?|軽減|装甲|防御).*?(\\d+)`, 'i');
                    const memoMatch = memoInfo.match(memoArmorRegex);
                    if (memoMatch && memoMatch[1]) armorValue = parseInt(memoMatch[1], 10);
                }

                const newArmor: Armor = {
                    id: `imported_a_${name.replace(/\s/g, '')}_${Date.now()}`,
                    name,
                    armorValue,
                    notes,
                };
                newChar.armor.push(newArmor);
            }
        }
    }

    // 8. Description
    let descriptionParts = [];
    const basicInfoDesc = basicInfo.split('\n').slice(1).join('\n').trim();
    if (basicInfoDesc) descriptionParts.push(basicInfoDesc);
    if (belongingsInfo) descriptionParts.push(`【所持品】\n${belongingsInfo}`);
    if (memoInfo) descriptionParts.push(`【メモ】\n${memoInfo}`);
    newChar.description = descriptionParts.join('\n\n').trim();

    return { character: newChar, allocations: newAllocations };
};

const WeaponArmorModal: React.FC<{
    modalConfig: { type: 'weapon' | 'armor'; itemToEdit: Weapon | Armor | null };
    onSave: (item: Weapon | Armor) => void;
    onClose: () => void;
}> = ({ modalConfig, onSave, onClose }) => {
    const { type, itemToEdit } = modalConfig;
    const isWeapon = type === 'weapon';
    const defaultWeapon: Weapon = { id: `w_${Date.now()}`, name: '', damage: '', range: '', attacksPerRound: 1, ammoCapacity: null, currentAmmo: null, durability: null, malfunction: null, notes: '' };
    const defaultArmor: Armor = { id: `a_${Date.now()}`, name: '', armorValue: 0, notes: '' };

    const [formData, setFormData] = useState<Weapon | Armor>(itemToEdit ? { ...itemToEdit } : (isWeapon ? defaultWeapon : defaultArmor));

    const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
        const { name, value, type: inputType } = e.target;

        let processedValue: string | number | null = value;
        if (inputType === 'number') {
            processedValue = value === '' ? null : parseInt(value, 10);
            if (name === 'armorValue' || name === 'attacksPerRound') {
                processedValue = value === '' ? 0 : parseInt(value, 10);
            }
        }
        setFormData(prev => ({ ...prev, [name]: processedValue }));
    };

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        onSave(formData);
    };

    return (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-4" onClick={onClose}>
            <div className="bg-gray-800 rounded-lg shadow-xl border border-purple-500/30 w-full max-w-2xl" onClick={e => e.stopPropagation()}>
                <form onSubmit={handleSubmit}>
                    <div className="p-6">
                        <div className="flex justify-between items-start mb-4">
                            <h2 className="text-2xl font-bold font-crimson text-purple-300">{itemToEdit ? '編集' : '新規追加'} - {isWeapon ? '武器' : '防具'}</h2>
                            <button type="button" onClick={onClose} className="text-gray-400 hover:text-white"><X size={24} /></button>
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div className="col-span-1 md:col-span-2">
                                <label htmlFor="name" className="block text-sm font-medium text-gray-300 mb-1">名前</label>
                                <input id="name" name="name" type="text" value={formData.name} onChange={handleChange} required className="w-full p-2 bg-gray-700 border border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-purple-400" />
                            </div>
                            {isWeapon && (formData as Weapon) &&
                                <>
                                    <div>
                                        <label htmlFor="damage" className="block text-sm font-medium text-gray-300 mb-1">ダメージ</label>
                                        <input id="damage" name="damage" type="text" value={(formData as Weapon).damage} onChange={handleChange} required className="w-full p-2 bg-gray-700 border border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-purple-400" />
                                    </div>
                                    <div>
                                        <label htmlFor="range" className="block text-sm font-medium text-gray-300 mb-1">射程</label>
                                        <input id="range" name="range" type="text" value={(formData as Weapon).range} onChange={handleChange} className="w-full p-2 bg-gray-700 border border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-purple-400" />
                                    </div>
                                    <div>
                                        <label htmlFor="attacksPerRound" className="block text-sm font-medium text-gray-300 mb-1">攻撃回数</label>
                                        <input id="attacksPerRound" name="attacksPerRound" type="number" min="0" value={(formData as Weapon).attacksPerRound} onChange={handleChange} className="w-full p-2 bg-gray-700 border border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-purple-400" />
                                    </div>
                                    <div>
                                        <label htmlFor="durability" className="block text-sm font-medium text-gray-300 mb-1">耐久力</label>
                                        <input id="durability" name="durability" type="number" min="0" value={(formData as Weapon).durability ?? ''} onChange={handleChange} placeholder="なし" className="w-full p-2 bg-gray-700 border border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-purple-400" />
                                    </div>
                                    <div>
                                        <label htmlFor="ammoCapacity" className="block text-sm font-medium text-gray-300 mb-1">装弾数</label>
                                        <input id="ammoCapacity" name="ammoCapacity" type="number" min="0" value={(formData as Weapon).ammoCapacity ?? ''} onChange={handleChange} placeholder="なし" className="w-full p-2 bg-gray-700 border border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-purple-400" />
                                    </div>
                                    <div>
                                        <label htmlFor="malfunction" className="block text-sm font-medium text-gray-300 mb-1">故障ナンバー</label>
                                        <input id="malfunction" name="malfunction" type="number" min="0" max="100" value={(formData as Weapon).malfunction ?? ''} onChange={handleChange} placeholder="なし" className="w-full p-2 bg-gray-700 border border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-purple-400" />
                                    </div>
                                </>
                            }
                            {!isWeapon && (formData as Armor) &&
                                <div className="col-span-1 md:col-span-2">
                                    <label htmlFor="armorValue" className="block text-sm font-medium text-gray-300 mb-1">装甲値</label>
                                    <input id="armorValue" name="armorValue" type="number" min="0" value={(formData as Armor).armorValue} onChange={handleChange} className="w-full p-2 bg-gray-700 border border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-purple-400" />
                                </div>
                            }
                            <div className="col-span-1 md:col-span-2">
                                <label htmlFor="notes" className="block text-sm font-medium text-gray-300 mb-1">備考</label>
                                <textarea id="notes" name="notes" value={formData.notes} onChange={handleChange} className="w-full p-2 bg-gray-700 border border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-purple-400 h-24 resize-y" />
                            </div>
                        </div>
                    </div>
                    <div className="bg-gray-900/50 px-6 py-3 flex justify-end gap-4 rounded-b-lg">
                        <button type="button" onClick={onClose} className="px-4 py-2 bg-gray-600 hover:bg-gray-500 text-white font-semibold rounded-md transition-colors">キャンセル</button>
                        <button type="submit" className="px-4 py-2 bg-purple-600 hover:bg-purple-500 text-white font-semibold rounded-md transition-colors">保存する</button>
                    </div>
                </form>
            </div>
        </div>
    );
};

const StatInput: React.FC<{
    label: string;
    value: number;
    onUpdate: (newValue: number) => void;
    onRollRequest: () => void;
}> = ({ label, value, onUpdate, onRollRequest }) => {
    const [displayValue, setDisplayValue] = useState(value.toString());

    useEffect(() => {
        setDisplayValue(value.toString());
    }, [value]);

    const handleBlur = () => {
        let numericValue = parseInt(displayValue, 10);
        if (isNaN(numericValue) || numericValue < 1) numericValue = 1;
        if (numericValue > 99) numericValue = 99;
        onUpdate(numericValue);
    };

    return (
        <div className="flex items-center justify-between">
            <label className="font-bold text-gray-300 w-12">{label}</label>
            <input
                type="number"
                value={displayValue}
                onChange={(e) => setDisplayValue(e.target.value)}
                onBlur={handleBlur}
                className="w-24 p-1 text-center bg-gray-700 border border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-purple-400"
            />
            <button
                onClick={onRollRequest}
                className="p-1.5 bg-gray-600 hover:bg-gray-500 rounded-md"
                title={`${label}の値をロールする`}
            >
                <Dices size={16} />
            </button>
        </div>
    );
};


export const CharacterCreationScreen: React.FC<{ onCharacterCreate: (characters: Character[]) => void; }> = ({ onCharacterCreate }) => {
    const [characters, setCharacters] = useState<Character[]>([]);
    const [activeCharacterId, setActiveCharacterId] = useState<string | null>(null);
    const [allocations, setAllocations] = useState<AllAllocations>({});
    const characterFileInputRef = useRef<HTMLInputElement>(null);
    const imageUploadRef = useRef<HTMLInputElement>(null);
    const [modalConfig, setModalConfig] = useState<{ isOpen: boolean; type: 'weapon' | 'armor' | null; itemToEdit: Weapon | Armor | null; }>({ isOpen: false, type: null, itemToEdit: null });
    const [customSkillModalOpen, setCustomSkillModalOpen] = useState(false);
    const [editingCustomSkill, setEditingCustomSkill] = useState<CustomSkill | null>(null);
    const [activeTab, setActiveTab] = useState('skills');
    const [isCustomOccupation, setIsCustomOccupation] = useState(false);
    const [isGeneratingBackground, setIsGeneratingBackground] = useState(false);

    const activeCharacter = useMemo(() => characters.find(c => c.id === activeCharacterId), [characters, activeCharacterId]);

    useEffect(() => {
        if (activeCharacter) {
            // If occupation exists and is not a preset, it's custom.
            if (activeCharacter.occupation && !Object.keys(OCCUPATIONS).includes(activeCharacter.occupation)) {
                setIsCustomOccupation(true);
            } else {
                // Also check if custom skills are populated, indicating an incomplete custom occupation
                const hasCustomSkills = (activeCharacter.customOccupationalSkills || []).length > 0;
                if (!activeCharacter.occupation && hasCustomSkills) {
                    setIsCustomOccupation(true);
                } else if (!Object.keys(OCCUPATIONS).includes(activeCharacter.occupation)) {
                    // This handles the case where occupation is empty string, but we haven't explicitly set it to custom
                    // If we have an occupation that isn't a preset, it must be custom.
                    // If occupation is blank, it's not custom unless the user selects it.
                    if (activeCharacter.occupation) {
                        setIsCustomOccupation(true);
                    }
                }
                else {
                    setIsCustomOccupation(false);
                }
            }
        } else {
            // Reset when no character is active
            setIsCustomOccupation(false);
        }
    }, [activeCharacter]);

    const updateCharacter = useCallback((id: string, newCharData: Partial<Character> | ((char: Character) => Partial<Character>)) => {
        setCharacters(prev => prev.map(c => {
            if (c.id === id) {
                const updates = typeof newCharData === 'function' ? newCharData(c) : newCharData;
                return { ...c, ...updates };
            }
            return c;
        }));
    }, []);

    const addNewCharacter = useCallback(() => {
        const newChar = createNewCharacter();
        setCharacters(prev => [...prev, newChar]);
        setActiveCharacterId(newChar.id);
        const newAllocs: CharacterAllocations = {};
        // 標準技能のアロケーション初期化
        for (const skill of ALL_SKILLS) {
            newAllocs[skill] = { occ: 0, int: 0 };
        }
        // 独自技能のアロケーション初期化（必要に応じて後で追加）
        setAllocations(prev => ({ ...prev, [newChar.id]: newAllocs }));
    }, []);

    const removeCharacter = (idToRemove: string) => {
        setCharacters(prev => prev.filter(c => c.id !== idToRemove));
        if (activeCharacterId === idToRemove) {
            const remainingChars = characters.filter(c => c.id !== idToRemove);
            setActiveCharacterId(remainingChars.length > 0 ? remainingChars[0].id : null);
        }
    };

    const handleCharacterImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        try {
            const text = await file.text();
            const { character: importedChar, allocations: importedAllocations } = parseIacharaText(text);

            setCharacters(prev => [...prev, importedChar]);
            setActiveCharacterId(importedChar.id);
            setAllocations(prev => ({ ...prev, [importedChar.id]: importedAllocations }));
        } catch (error) {
            console.error("Failed to parse character sheet:", error);
            alert("キャラクターシートの解析に失敗しました。ファイル形式を確認してください。");
        }
        if (e.target) e.target.value = '';
    };

    const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files[0] && activeCharacterId) {
            const file = e.target.files[0];
            if (!file.type.startsWith('image/')) {
                alert('画像ファイルを選択してください。');
                return;
            }
            if (file.size > 5 * 1024 * 1024) { // 5MB limit
                alert('ファイルサイズが大きすぎます。5MB以下の画像を選択してください。');
                return;
            }

            const reader = new FileReader();
            reader.onloadend = () => {
                if (reader.result) {
                    updateCharacter(activeCharacterId, { iconUrl: reader.result as string });
                }
            };
            reader.readAsDataURL(file);
        }
    };

    const handleOpenModal = (type: 'weapon' | 'armor', itemToEdit: Weapon | Armor | null = null) => {
        setModalConfig({ isOpen: true, type, itemToEdit });
    };

    const handleCloseModal = () => {
        setModalConfig({ isOpen: false, type: null, itemToEdit: null });
    };

    const handleSaveItem = (itemData: Weapon | Armor) => {
        if (!activeCharacter || !modalConfig.type) return;

        const isNewItem = !modalConfig.itemToEdit;
        const listName = modalConfig.type === 'weapon' ? 'weapons' : 'armor';

        updateCharacter(activeCharacter.id, (char) => {
            const list = (char as any)[listName] as Array<Weapon | Armor>;
            let newList;
            if (isNewItem) {
                newList = [...list, itemData];
            } else {
                newList = list.map(item => item.id === itemData.id ? itemData : item);
            }
            return { [listName]: newList };
        });

        handleCloseModal();
    };

    const handleDeleteItem = (type: 'weapon' | 'armor', itemId: string) => {
        if (!activeCharacter) return;

        const listName = type === 'weapon' ? 'weapons' : 'armor';

        updateCharacter(activeCharacter.id, char => {
            const list = (char as any)[listName] as Array<Weapon | Armor>;
            const newList = list.filter(item => item.id !== itemId);
            return { [listName]: newList };
        });
    };

    const handleStatUpdate = (id: string, statName: keyof Character['stats'], value: number) => {
        updateCharacter(id, char => {
            const newStats = { ...char.stats, [statName]: value };

            const newHP = Math.ceil((newStats.CON + newStats.SIZ) / 2);
            const newMP = newStats.POW;
            const newSAN = newStats.POW * 5;

            const newSkills = { ...char.skills };
            // Recalculate dynamic base skills and totals if DEX or EDU changed
            if (statName === 'DEX' || statName === 'EDU') {
                const allSkillNames = [...ALL_SKILLS, ...(char.customSkills || []).map(cs => cs.name)];
                for (const skillName of allSkillNames) {
                    const base = getBaseSkillValue(skillName, newStats, char.customSkills || []);
                    const alloc = allocations[id]?.[skillName] || { occ: 0, int: 0 };
                    newSkills[skillName] = base + alloc.occ + alloc.int;
                }
            }

            return {
                stats: newStats,
                hp: { max: newHP, current: newHP },
                mp: { max: newMP, current: newMP },
                san: { max: newSAN, current: char.san.current > newSAN ? newSAN : char.san.current },
                skills: newSkills
            };
        });
    };

    const handleStatRollRequest = (statName: keyof Character['stats']) => {
        if (!activeCharacter) return;
        const notation = getStatRollNotation(statName);
        const result = parseAndRoll(notation);
        handleStatUpdate(activeCharacter.id, statName, result);
    };

    const handleRollAllStats = () => {
        if (!activeCharacterId) return;

        updateCharacter(activeCharacterId, char => {
            const newStats = { ...char.stats };
            (Object.keys(newStats) as Array<keyof Character['stats']>).forEach(statName => {
                const notation = getStatRollNotation(statName);
                newStats[statName] = parseAndRoll(notation);
            });

            const newHP = Math.ceil((newStats.CON + newStats.SIZ) / 2);
            const newMP = newStats.POW;
            const newSAN = newStats.POW * 5;

            const newSkills = { ...char.skills };
            // After all stats are updated, recalculate all skills
            const allSkillNames = [...ALL_SKILLS, ...(char.customSkills || []).map(cs => cs.name)];
            for (const skillName of allSkillNames) {
                const base = getBaseSkillValue(skillName, newStats, char.customSkills || []);
                const alloc = allocations[char.id]?.[skillName] || { occ: 0, int: 0 };
                const total = base + alloc.occ + alloc.int;
                newSkills[skillName] = total > 99 ? 99 : total;
            }

            return {
                stats: newStats,
                hp: { max: newHP, current: newHP },
                mp: { max: newMP, current: newMP },
                san: { max: newSAN, current: char.san.current > newSAN ? newSAN : char.san.current },
                skills: newSkills,
            };
        });
    };


    const handleSkillAllocation = (charId: string, skillName: string, type: 'occ' | 'int', value: number) => {
        if (value < 0) value = 0;

        const charAllocs = allocations[charId] || {};
        const newAllocs = { ...charAllocs, [skillName]: { ...charAllocs[skillName], [type]: value } };

        setAllocations(prev => ({ ...prev, [charId]: newAllocs }));

        updateCharacter(charId, char => {
            const base = getBaseSkillValue(skillName, char.stats, char.customSkills || []);
            const newSkillValue = base + newAllocs[skillName].occ + newAllocs[skillName].int;
            return { skills: { ...char.skills, [skillName]: newSkillValue } };
        });
    };

    const handleOccupationChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
        if (!activeCharacterId) return;
        const newOccupation = e.target.value;

        if (newOccupation === 'CUSTOM') {
            setIsCustomOccupation(true);
            updateCharacter(activeCharacterId, { occupation: '' }); // Clear occupation to allow custom input
        } else {
            setIsCustomOccupation(false);
            // When switching to a preset, clear custom skills and reset occupation
            updateCharacter(activeCharacterId, { occupation: newOccupation, customOccupationalSkills: [] });
        }
    };

    const handleCustomOccSkillToggle = (charId: string, skillName: string) => {
        updateCharacter(charId, char => {
            const currentSkills = char.customOccupationalSkills || [];
            const isSelected = currentSkills.includes(skillName);
            let newSkills;
            if (isSelected) {
                newSkills = currentSkills.filter(s => s !== skillName);
            } else {
                if (currentSkills.length >= 8) return {}; // Don't add if already 8
                newSkills = [...currentSkills, skillName];
            }
            return { customOccupationalSkills: newSkills };
        });
    };

    // 独自技能の追加
    const handleAddCustomSkill = (skillData: Omit<CustomSkill, 'id'>) => {
        if (!activeCharacter) return;

        const newSkill: CustomSkill = {
            ...skillData,
            id: `custom_${skillData.name.replace(/\s/g, '')}_${Date.now()}`
        };

        updateCharacter(activeCharacter.id, char => {
            const customSkills = [...(char.customSkills || []), newSkill];
            const newSkills = { ...char.skills };
            
            // 新しい独自技能のスキル値を初期化
            newSkills[newSkill.name] = newSkill.baseValue;
            
            return { customSkills, skills: newSkills };
        });

        // アロケーションも初期化
        setAllocations(prev => ({
            ...prev,
            [activeCharacter.id]: {
                ...prev[activeCharacter.id],
                [newSkill.name]: { occ: 0, int: 0 }
            }
        }));
    };

    // 独自技能の編集
    const handleEditCustomSkill = (skillData: CustomSkill) => {
        if (!activeCharacter) return;

        updateCharacter(activeCharacter.id, char => {
            const customSkills = (char.customSkills || []).map(skill => 
                skill.id === skillData.id ? skillData : skill
            );
            
            const newSkills = { ...char.skills };
            // スキル値を再計算
            const allocation = allocations[activeCharacter.id]?.[skillData.name] || { occ: 0, int: 0 };
            newSkills[skillData.name] = skillData.baseValue + allocation.occ + allocation.int;
            
            return { customSkills, skills: newSkills };
        });
    };

    // 独自技能の削除
    const handleDeleteCustomSkill = (skillId: string) => {
        if (!activeCharacter) return;

        const skillToDelete = activeCharacter.customSkills?.find(skill => skill.id === skillId);
        if (!skillToDelete) return;

        updateCharacter(activeCharacter.id, char => {
            const customSkills = (char.customSkills || []).filter(skill => skill.id !== skillId);
            const newSkills = { ...char.skills };
            delete newSkills[skillToDelete.name];
            
            // カスタム職業技能からも削除
            const customOccupationalSkills = (char.customOccupationalSkills || [])
                .filter(skillName => skillName !== skillToDelete.name);
            
            return { 
                customSkills, 
                skills: newSkills, 
                customOccupationalSkills 
            };
        });

        // アロケーションからも削除
        setAllocations(prev => {
            const newAllocs = { ...prev };
            if (newAllocs[activeCharacter.id]) {
                delete newAllocs[activeCharacter.id][skillToDelete.name];
            }
            return newAllocs;
        });
    };

    const handleResetAllPoints = () => {
        if (!activeCharacterId) return;

        updateCharacter(activeCharacterId, (char) => {
            const newAllocsForChar: CharacterAllocations = {};
            const newSkills = { ...char.skills };

            const allSkillNames = [...ALL_SKILLS, ...(char.customSkills || []).map(cs => cs.name)];
            for (const skillName of allSkillNames) {
                // Reset both occupation and interest points
                newAllocsForChar[skillName] = { occ: 0, int: 0 };

                // Recalculate total skill value to its base
                const base = getBaseSkillValue(skillName, char.stats, char.customSkills || []);
                newSkills[skillName] = base;
            }

            setAllocations(prev => ({ ...prev, [char.id]: newAllocsForChar }));
            return { skills: newSkills };
        });
    };

    const handleAutoAllocateAllPoints = () => {
        if (!activeCharacter || !derivedData) return;

        const occupationalSkills = isCustomOccupation
            ? activeCharacter.customOccupationalSkills || []
            : OCCUPATIONS[activeCharacter.occupation] || [];

        if (occupationalSkills.length === 0) {
            alert('自動割り振りには、まず職業と職業技能を選択してください。');
            return;
        }

        let occPointsToDistribute = derivedData.occupationPoints;
        let intPointsToDistribute = derivedData.interestPoints;

        updateCharacter(activeCharacter.id, (char) => {
            const newAllocsForChar: CharacterAllocations = {};
            // Initialize all allocations to zero
            const allSkillNames = [...ALL_SKILLS, ...(char.customSkills || []).map(cs => cs.name)];
            for (const skillName of allSkillNames) {
                newAllocsForChar[skillName] = { occ: 0, int: 0 };
            }

            // Allocate Occupation Points
            let availableOccSkills = [...occupationalSkills];
            while (occPointsToDistribute > 0 && availableOccSkills.length > 0) {
                const randomIndex = Math.floor(Math.random() * availableOccSkills.length);
                const randomSkill = availableOccSkills[randomIndex];

                const base = getBaseSkillValue(randomSkill, char.stats, char.customSkills || []);
                const currentAlloc = newAllocsForChar[randomSkill];
                const currentTotal = base + currentAlloc.occ + currentAlloc.int;

                if (currentTotal < 99) {
                    currentAlloc.occ++;
                    occPointsToDistribute--;
                } else {
                    availableOccSkills.splice(randomIndex, 1);
                }
            }

            // Allocate Interest Points
            let availableIntSkills = [...allSkillNames];
            while (intPointsToDistribute > 0 && availableIntSkills.length > 0) {
                const randomIndex = Math.floor(Math.random() * availableIntSkills.length);
                const randomSkill = availableIntSkills[randomIndex];

                const base = getBaseSkillValue(randomSkill, char.stats, char.customSkills || []);
                const currentAlloc = newAllocsForChar[randomSkill];
                const currentTotal = base + currentAlloc.occ + currentAlloc.int;

                if (currentTotal < 99) {
                    currentAlloc.int++;
                    intPointsToDistribute--;
                } else {
                    availableIntSkills.splice(randomIndex, 1);
                }
            }

            // Final calculation of skill totals
            const newSkills = { ...char.skills };
            for (const skillName of allSkillNames) {
                const base = getBaseSkillValue(skillName, char.stats, char.customSkills || []);
                const alloc = newAllocsForChar[skillName];
                const newTotal = base + alloc.occ + alloc.int;
                newSkills[skillName] = newTotal > 99 ? 99 : newTotal; // Cap at 99
            }

            setAllocations(prev => ({ ...prev, [char.id]: newAllocsForChar }));
            return { skills: newSkills };
        });
    };


    const handleGenerateBackground = async () => {
        if (!activeCharacter || !activeCharacter.occupation || !activeCharacter.name || activeCharacter.name === '無名の探索者') {
            alert('キャラクターの名前と職業を先に設定してください。');
            return;
        }
        setIsGeneratingBackground(true);
        try {
            const background = await generateCharacterBackground(activeCharacter.name, activeCharacter.occupation);
            updateCharacter(activeCharacter.id, (char) => ({ description: char.description ? `${char.description}\n\n--- AI生成 ---\n${background}` : background }));
        } catch (error) {
            console.error("AI background generation failed:", error);
            alert('背景の生成に失敗しました。再度お試しください。');
        } finally {
            setIsGeneratingBackground(false);
        }
    };

    const derivedData = useMemo(() => {
        if (!activeCharacter) return null;
        const rawStats = activeCharacter.stats;
        const occupationPoints = rawStats.EDU * 20;
        const interestPoints = rawStats.INT * 10;
        const damageBonus = calculateDamageBonus(rawStats.STR, rawStats.SIZ);
        const idea = rawStats.INT * 5;
        const luck = rawStats.POW * 5;
        const knowledge = rawStats.EDU * 5;

        const currentAllocs = allocations[activeCharacter.id] || {};
        const spentOccPoints = Object.values(currentAllocs).reduce((sum, a) => sum + (a.occ || 0), 0);
        const spentIntPoints = Object.values(currentAllocs).reduce((sum, a) => sum + (a.int || 0), 0);

        const selectedOccSkillsCount = isCustomOccupation ? (activeCharacter.customOccupationalSkills?.length || 0) : 0;

        return {
            rawStats, occupationPoints, interestPoints, damageBonus, idea, luck, knowledge,
            spentOccPoints, spentIntPoints, selectedOccSkillsCount
        };
    }, [activeCharacter, allocations, isCustomOccupation]);

    useEffect(() => {
        if (characters.length > 0 && !activeCharacterId) {
            setActiveCharacterId(characters[0].id);
        }
    }, [characters, activeCharacterId]);

    const canStartGame = characters.length > 0 && characters.every(c => c.name && c.occupation);

    return (
        <div className="min-h-screen bg-gray-900 text-gray-200 flex flex-col items-center p-2 sm:p-4 font-sans">
            {modalConfig.isOpen && modalConfig.type && (
                <WeaponArmorModal
                    modalConfig={modalConfig as { type: 'weapon' | 'armor'; itemToEdit: Weapon | Armor | null }}
                    onSave={handleSaveItem}
                    onClose={handleCloseModal}
                />
            )}
            <CustomSkillModal
                isOpen={customSkillModalOpen}
                editingSkill={editingCustomSkill}
                onSave={handleAddCustomSkill}
                onEdit={handleEditCustomSkill}
                onClose={() => {
                    setCustomSkillModalOpen(false);
                    setEditingCustomSkill(null);
                }}
            />
            <input
                type="file"
                ref={characterFileInputRef}
                className="hidden"
                accept=".txt,text/plain"
                onChange={handleCharacterImport}
            />
            <input
                type="file"
                ref={imageUploadRef}
                className="hidden"
                accept="image/png, image/jpeg, image/gif"
                onChange={handleImageChange}
            />

            <div className="w-full max-w-7xl">
                <header className="text-center mb-4">
                    <h1 className="text-4xl sm:text-5xl font-bold font-crimson text-purple-300 mt-2">探索者の創造</h1>
                    <p className="text-gray-400 mt-2">神話の世界に足を踏み入れる、あなたの分身を作り上げましょう。</p>
                </header>

                <div className="max-w-3xl mx-auto text-center mb-6 p-3 bg-gray-800/60 border border-purple-500/20 rounded-lg flex items-center justify-center gap-3">
                    <Info size={20} className="text-purple-300 flex-shrink-0" />
                    <p className="text-sm text-gray-300">
                        キャラクターシート作成サイト
                        <a href="https://iachara.com/" target="_blank" rel="noopener noreferrer" className="text-purple-300 hover:text-purple-200 font-semibold mx-1">「いあきゃら」</a>
                        で作成したTXTファイルを読み込んでキャラクターを追加することもできます。
                    </p>
                </div>

                <div className="bg-gray-800/50 rounded-lg shadow-lg border border-purple-500/20 p-2 sm:p-4">
                    <div className="flex items-center border-b border-purple-500/20 pb-3 mb-4">
                        <div className="flex items-center space-x-2 overflow-x-auto py-2 pr-4">
                            {characters.map(char => (
                                <div key={char.id} className="relative group">
                                    <button
                                        onClick={() => setActiveCharacterId(char.id)}
                                        className={`px-4 py-2 rounded-md transition-colors flex items-center whitespace-nowrap ${activeCharacterId === char.id ? 'bg-purple-600 text-white' : 'bg-gray-700 hover:bg-gray-600'}`}
                                    >
                                        <User size={14} className="mr-2" />
                                        {char.name || '無名の探索者'}
                                    </button>
                                    <button onClick={() => removeCharacter(char.id)} className="absolute -top-2 -right-2 bg-red-600 text-white rounded-full p-0.5 opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-500" aria-label={`Remove ${char.name}`}>
                                        <X size={14} />
                                    </button>
                                </div>
                            ))}
                        </div>
                        <div className="flex-shrink-0 flex items-center ml-auto pl-2 space-x-2">
                            <button onClick={addNewCharacter} className="px-3 py-2 bg-green-700 hover:bg-green-800 text-white font-semibold rounded-md transition-colors flex items-center whitespace-nowrap" title="空のキャラクターを新規作成します">
                                <UserPlus size={16} className="mr-2" /> 新規作成
                            </button>
                            <button onClick={() => characterFileInputRef.current?.click()} className="px-3 py-2 bg-blue-700 hover:bg-blue-800 text-white font-semibold rounded-md transition-colors flex items-center whitespace-nowrap" title="キャラクターシート作成サイト「いあきゃら」で出力したTXTファイルを読み込みます">
                                <UploadCloud size={16} className="mr-2" /> いあきゃら
                            </button>
                        </div>
                    </div>

                    {activeCharacter && derivedData ? (
                        <div className="mt-4 grid grid-cols-1 lg:grid-cols-3 gap-6">
                            <div className="lg:col-span-1 space-y-4">
                                <div className="bg-gray-900/40 p-3 rounded-lg">
                                    <h3 className="text-lg font-bold font-crimson text-purple-200 mb-3">基本設定</h3>
                                    <div className="flex flex-col items-center mb-4">
                                        <div className="relative group w-24 h-24">
                                            <button
                                                type="button"
                                                onClick={() => imageUploadRef.current?.click()}
                                                className="w-24 h-24 rounded-full bg-gray-700 flex items-center justify-center border-2 border-dashed border-gray-500 group-hover:border-purple-400 transition-colors"
                                                aria-label="キャラクターの画像をアップロード"
                                            >
                                                {activeCharacter.iconUrl ? (
                                                    <img src={activeCharacter.iconUrl} alt={activeCharacter.name} className="w-full h-full rounded-full object-cover" />
                                                ) : (
                                                    <User size={40} className="text-gray-500" />
                                                )}
                                            </button>
                                            <div
                                                className="absolute inset-0 rounded-full bg-black/60 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer"
                                                onClick={() => imageUploadRef.current?.click()}
                                            >
                                                <UploadCloud size={32} className="text-white" />
                                            </div>
                                        </div>
                                    </div>
                                    <input type="text" placeholder="探索者の名前" value={activeCharacter.name} onChange={(e) => updateCharacter(activeCharacter.id, { name: e.target.value })} className="w-full p-2 bg-gray-700 border border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-purple-400 mb-2" />
                                    <div className="mb-2">
                                        <div className="relative">
                                            <select
                                                value={isCustomOccupation ? 'CUSTOM' : (activeCharacter.occupation || '')}
                                                onChange={handleOccupationChange}
                                                className="w-full p-2 pr-8 bg-gray-700 border border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-purple-400 appearance-none"
                                            >
                                                <option value="" disabled>職業を選択...</option>
                                                {Object.keys(OCCUPATIONS).sort((a, b) => a.localeCompare(b, 'ja')).map(occ => (
                                                    <option key={occ} value={occ}>{occ}</option>
                                                ))}
                                                <option value="CUSTOM">その他（自由入力）</option>
                                            </select>
                                            <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-2 text-gray-400">
                                                <ChevronsUpDown size={16} />
                                            </div>
                                        </div>
                                        {isCustomOccupation && (
                                            <input
                                                type="text"
                                                placeholder="職業を自由入力"
                                                value={activeCharacter.occupation}
                                                onChange={(e) => updateCharacter(activeCharacter.id, { occupation: e.target.value })}
                                                className="w-full p-2 bg-gray-700 border border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-purple-400 mt-2"
                                            />
                                        )}
                                    </div>
                                </div>

                                <div className="bg-gray-900/40 p-3 rounded-lg">
                                    <div className="flex justify-between items-center mb-3">
                                        <h3 className="text-lg font-bold font-crimson text-purple-200">能力値</h3>
                                        <button onClick={handleRollAllStats} className="flex items-center text-sm px-2 py-1 bg-purple-600 hover:bg-purple-500 rounded-md transition-colors"><Dices size={14} className="mr-1" />一括ロール</button>
                                    </div>
                                    <div className="space-y-2">
                                        {Object.keys(activeCharacter.stats).map(statKey => (
                                            <StatInput
                                                key={statKey}
                                                label={statKey}
                                                value={derivedData.rawStats[statKey as keyof typeof derivedData.rawStats]}
                                                onUpdate={(v) => handleStatUpdate(activeCharacter.id, statKey as keyof Character['stats'], v)}
                                                onRollRequest={() => handleStatRollRequest(statKey as keyof Character['stats'])}
                                            />
                                        ))}
                                    </div>
                                </div>

                                <div className="bg-gray-900/40 p-3 rounded-lg">
                                    <h3 className="text-lg font-bold font-crimson text-purple-200 mb-3">派生ステータス</h3>
                                    <div className="space-y-2 text-sm">
                                        <div className="flex justify-between"><span>耐久力(HP):</span> <span className="font-bold">{activeCharacter.hp.max}</span></div>
                                        <div className="flex justify-between"><span>マジックポイント(MP):</span> <span className="font-bold">{activeCharacter.mp.max}</span></div>
                                        <div className="flex justify-between"><span>最大正気度(SAN):</span> <span className="font-bold">{activeCharacter.san.max}</span></div>
                                        <div className="flex justify-between"><span>ダメージボーナス(DB):</span> <span className="font-bold">{derivedData.damageBonus}</span></div>
                                        <hr className="border-gray-700 my-1" />
                                        <div className="flex justify-between"><span>アイデア:</span> <span className="font-bold">{derivedData.idea}%</span></div>
                                        <div className="flex justify-between"><span>幸運:</span> <span className="font-bold">{derivedData.luck}%</span></div>
                                        <div className="flex justify-between"><span>知識:</span> <span className="font-bold">{derivedData.knowledge}%</span></div>
                                    </div>
                                </div>

                                <div className="bg-gray-900/40 p-3 rounded-lg">
                                    <div className="flex justify-between items-center mb-3">
                                        <h3 className="text-lg font-bold font-crimson text-purple-200">スキルポイント</h3>
                                        <div className="flex items-center gap-1">
                                            <button onClick={handleResetAllPoints} title="全スキルポイントをリセット" className="p-1.5 text-gray-400 hover:text-white rounded-full hover:bg-gray-700 transition-colors"><RotateCcw size={16} /></button>
                                            <button onClick={handleAutoAllocateAllPoints} title="全スキルポイントを自動割り振り" className="p-1.5 text-gray-400 hover:text-white rounded-full hover:bg-gray-700 transition-colors"><Sparkles size={16} /></button>
                                        </div>
                                    </div>
                                    <div className={`flex justify-between items-center text-sm p-2 rounded ${derivedData.spentOccPoints > derivedData.occupationPoints ? 'bg-red-900/50' : 'bg-gray-800/50'}`}>
                                        <span>職業ポイント:</span>
                                        <span className="font-bold">{derivedData.spentOccPoints} / {derivedData.occupationPoints}</span>
                                    </div>
                                    {isCustomOccupation && (
                                        <div className={`flex justify-between items-center text-sm p-2 rounded mt-2 ${derivedData.selectedOccSkillsCount > 8 ? 'bg-red-900/50' : 'bg-gray-800/50'}`}>
                                            <span>選択中の職業技能:</span>
                                            <span className={`font-bold ${derivedData.selectedOccSkillsCount > 8 ? 'text-red-400' : ''}`}>{derivedData.selectedOccSkillsCount} / 8</span>
                                        </div>
                                    )}
                                    <div className={`flex justify-between text-sm p-2 rounded mt-2 ${derivedData.spentIntPoints > derivedData.interestPoints ? 'bg-red-900/50' : 'bg-gray-800/50'}`}>
                                        <span>興味ポイント:</span>
                                        <span className="font-bold">{derivedData.spentIntPoints} / {derivedData.interestPoints}</span>
                                    </div>
                                </div>

                            </div>
                            <div className="lg:col-span-2 space-y-4">
                                <div className="bg-gray-900/40 p-3 rounded-lg">
                                    <div className="flex border-b border-purple-500/20 mb-3">
                                        <button onClick={() => setActiveTab('skills')} className={`px-4 py-2 font-semibold ${activeTab === 'skills' ? 'border-b-2 border-purple-400 text-purple-300' : 'text-gray-400'}`}>技能</button>
                                        <button onClick={() => setActiveTab('equipment')} className={`px-4 py-2 font-semibold ${activeTab === 'equipment' ? 'border-b-2 border-purple-400 text-purple-300' : 'text-gray-400'}`}>装備</button>
                                        <button onClick={() => setActiveTab('background')} className={`px-4 py-2 font-semibold ${activeTab === 'background' ? 'border-b-2 border-purple-400 text-purple-300' : 'text-gray-400'}`}>背景</button>
                                    </div>

                                    {activeTab === 'skills' && (
                                        <div className="max-h-[60vh] overflow-y-auto pr-2">
                                            <div className={`grid ${isCustomOccupation ? 'grid-cols-7' : 'grid-cols-6'} text-xs text-center font-bold text-gray-400 px-2 pb-2 border-b border-gray-700`}>
                                                {isCustomOccupation && <div className="text-center" title="職業技能">職</div>}
                                                <div className="col-span-2 text-left">技能名</div>
                                                <div>合計</div>
                                                <div>初期値</div>
                                                <div>職業P</div>
                                                <div>興味P</div>
                                            </div>
                                            {Object.entries(SKILL_CATEGORIES).map(([category, skills]) => {
                                                // 標準技能にそのカテゴリの独自技能を追加
                                                const customSkillsInCategory = (activeCharacter.customSkills || [])
                                                    .filter(cs => cs.category === category)
                                                    .map(cs => cs.name);
                                                
                                                const displaySkills = [
                                                    ...skills.filter(s => ALL_SKILLS.includes(s)),
                                                    ...customSkillsInCategory
                                                ];
                                                
                                                // 空のカテゴリはスキップ
                                                if (displaySkills.length === 0) return null;

                                                return (
                                                <details key={category} open className="mb-2">
                                                    <summary className="font-bold text-purple-300 cursor-pointer p-2 hover:bg-gray-800/50 rounded flex justify-between items-center">
                                                        <span>{category}</span>
                                                        <button 
                                                            onClick={(e) => {
                                                                e.stopPropagation();
                                                                setCustomSkillModalOpen(true);
                                                                setEditingCustomSkill(null);
                                                            }}
                                                            className="flex items-center text-xs px-2 py-1 bg-purple-600 hover:bg-purple-500 rounded ml-2"
                                                            title="独自技能を追加"
                                                        >
                                                            <PlusCircle size={12} className="mr-1" />
                                                            独自技能追加
                                                        </button>
                                                    </summary>
                                                    <div className="space-y-1 pl-2">
                                                        {displaySkills.map(skillName => {
                                                            const baseValue = getBaseSkillValue(skillName, activeCharacter.stats, activeCharacter.customSkills || []);
                                                            const totalValue = activeCharacter.skills[skillName] || baseValue;
                                                            const currentAlloc = allocations[activeCharacter.id]?.[skillName] || { occ: 0, int: 0 };

                                                            const isPresetOccSkill = (OCCUPATIONS[activeCharacter.occupation] || []).includes(skillName);
                                                            const isCustomSelectedOccSkill = isCustomOccupation && (activeCharacter.customOccupationalSkills || []).includes(skillName);
                                                            const isOccSkill = !isCustomOccupation ? isPresetOccSkill : isCustomSelectedOccSkill;
                                                            const isCustomSkill = customSkillsInCategory.includes(skillName);

                                                            return (
                                                                <div key={skillName} className={`grid ${isCustomOccupation ? 'grid-cols-7' : 'grid-cols-6'} items-center text-sm py-1 px-2 rounded hover:bg-gray-800/50 group`}>
                                                                    {isCustomOccupation && (
                                                                        <div className="text-center">
                                                                            <input
                                                                                type="checkbox"
                                                                                checked={isCustomSelectedOccSkill}
                                                                                onChange={() => handleCustomOccSkillToggle(activeCharacter.id, skillName)}
                                                                                disabled={!isCustomSelectedOccSkill && derivedData.selectedOccSkillsCount >= 8}
                                                                                className="form-checkbox h-4 w-4 bg-gray-700 border-gray-600 rounded text-purple-500 focus:ring-purple-400 disabled:bg-gray-800 disabled:cursor-not-allowed"
                                                                                title={!isCustomSelectedOccSkill && derivedData.selectedOccSkillsCount >= 8 ? "職業技能は8つまで選択できます" : "職業技能として設定"}
                                                                            />
                                                                        </div>
                                                                    )}
                                                                    <div className={`col-span-2 font-semibold flex items-center justify-between ${isOccSkill ? 'text-purple-300' : ''}`} title={isOccSkill ? '職業技能' : ''}>
                                                                        <span>{skillName}{isCustomSkill ? ' (独自)' : ''}</span>
                                                                        {isCustomSkill && (
                                                                            <div className="flex items-center space-x-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                                                                <button 
                                                                                    onClick={() => {
                                                                                        const skill = activeCharacter.customSkills?.find(cs => cs.name === skillName);
                                                                                        if (skill) {
                                                                                            setEditingCustomSkill(skill);
                                                                                            setCustomSkillModalOpen(true);
                                                                                        }
                                                                                    }}
                                                                                    className="p-1 hover:text-purple-300"
                                                                                    title="編集"
                                                                                >
                                                                                    <Pencil size={12} />
                                                                                </button>
                                                                                <button 
                                                                                    onClick={() => {
                                                                                        const skill = activeCharacter.customSkills?.find(cs => cs.name === skillName);
                                                                                        if (skill) {
                                                                                            handleDeleteCustomSkill(skill.id);
                                                                                        }
                                                                                    }}
                                                                                    className="p-1 hover:text-red-400"
                                                                                    title="削除"
                                                                                >
                                                                                    <Trash2 size={12} />
                                                                                </button>
                                                                            </div>
                                                                        )}
                                                                    </div>
                                                                    <div className="text-center font-bold">{totalValue}%</div>
                                                                    <div className="text-center text-gray-400">{baseValue}</div>
                                                                    <div className="text-center">
                                                                        <input
                                                                            type="number"
                                                                            min="0"
                                                                            value={currentAlloc.occ}
                                                                            onChange={e => handleSkillAllocation(activeCharacter.id, skillName, 'occ', parseInt(e.target.value) || 0)}
                                                                            className="w-12 p-1 text-center bg-gray-700 border border-gray-600 rounded-md disabled:bg-gray-800 disabled:text-gray-500 disabled:cursor-not-allowed"
                                                                            disabled={!isOccSkill}
                                                                            title={!isOccSkill ? 'この技能は職業技能ではありません' : '職業ポイントを割り振ります'}
                                                                        />
                                                                    </div>
                                                                    <div className="text-center">
                                                                        <input type="number" min="0" value={currentAlloc.int} onChange={e => handleSkillAllocation(activeCharacter.id, skillName, 'int', parseInt(e.target.value) || 0)} className="w-12 p-1 text-center bg-gray-700 border border-gray-600 rounded-md" />
                                                                    </div>
                                                                </div>
                                                            );
                                                        })}
                                                    </div>
                                                </details>
                                                );
                                            })}
                                        </div>
                                    )}

                                    {activeTab === 'equipment' && (
                                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                            <div>
                                                <div className="flex justify-between items-center mb-2">
                                                    <h4 className="font-bold flex items-center"><Sword size={18} className="mr-2 text-purple-300" />武器</h4>
                                                    <button onClick={() => handleOpenModal('weapon')} className="flex items-center text-sm px-2 py-1 bg-purple-600 hover:bg-purple-500 rounded"><PlusCircle size={14} className="mr-1" />追加</button>
                                                </div>
                                                <ul className="space-y-2 max-h-48 overflow-y-auto pr-2">
                                                    {activeCharacter.weapons.map(w => (
                                                        <li key={w.id} className="text-sm bg-gray-800/50 p-2 rounded flex justify-between items-center group">
                                                            <div><p className="font-semibold">{w.name}</p><p className="text-xs text-gray-400">{w.damage}, {w.range}</p></div>
                                                            <div className="flex items-center space-x-2 opacity-0 group-hover:opacity-100 transition-opacity">
                                                                <button onClick={() => handleOpenModal('weapon', w)} className="p-1 hover:text-purple-300"><Pencil size={16} /></button>
                                                                <button onClick={() => handleDeleteItem('weapon', w.id)} className="p-1 hover:text-red-400"><Trash2 size={16} /></button>
                                                            </div>
                                                        </li>
                                                    ))}
                                                    {activeCharacter.weapons.length === 0 && <li className="text-sm text-gray-500 italic">武器がありません</li>}
                                                </ul>
                                            </div>
                                            <div>
                                                <div className="flex justify-between items-center mb-2">
                                                    <h4 className="font-bold flex items-center"><Shield size={18} className="mr-2 text-purple-300" />防具</h4>
                                                    <button onClick={() => handleOpenModal('armor')} className="flex items-center text-sm px-2 py-1 bg-purple-600 hover:bg-purple-500 rounded"><PlusCircle size={14} className="mr-1" />追加</button>
                                                </div>
                                                <ul className="space-y-2 max-h-48 overflow-y-auto pr-2">
                                                    {activeCharacter.armor.map(a => (
                                                        <li key={a.id} className="text-sm bg-gray-800/50 p-2 rounded flex justify-between items-center group">
                                                            <div><p className="font-semibold">{a.name}</p><p className="text-xs text-gray-400">装甲: {a.armorValue}</p></div>
                                                            <div className="flex items-center space-x-2 opacity-0 group-hover:opacity-100 transition-opacity">
                                                                <button onClick={() => handleOpenModal('armor', a)} className="p-1 hover:text-purple-300"><Pencil size={16} /></button>
                                                                <button onClick={() => handleDeleteItem('armor', a.id)} className="p-1 hover:text-red-400"><Trash2 size={16} /></button>
                                                            </div>
                                                        </li>
                                                    ))}
                                                    {activeCharacter.armor.length === 0 && <li className="text-sm text-gray-500 italic">防具がありません</li>}
                                                </ul>
                                            </div>
                                        </div>
                                    )}

                                    {activeTab === 'background' && (
                                        <div>
                                            <div className="flex justify-end mb-2">
                                                <button
                                                    onClick={handleGenerateBackground}
                                                    disabled={isGeneratingBackground || !activeCharacter.occupation || !activeCharacter.name || activeCharacter.name === '無名の探索者'}
                                                    className="flex items-center text-sm px-3 py-1.5 bg-purple-600 hover:bg-purple-500 rounded-md transition-colors disabled:bg-gray-600 disabled:cursor-not-allowed"
                                                >
                                                    <BrainCircuit size={16} className="mr-2" />
                                                    {isGeneratingBackground ? '作成中...' : '背景を自動作成'}
                                                </button>
                                            </div>
                                            <textarea placeholder="キャラクター設定、背景、メモなど" value={activeCharacter.description} onChange={(e) => updateCharacter(activeCharacter.id, { description: e.target.value })} className="w-full p-2 bg-gray-700 border border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-purple-400 h-96 resize-y" />
                                        </div>
                                    )}

                                </div>
                            </div>
                        </div>
                    ) : (
                        <div className="text-center py-12 text-gray-500">
                            <Users size={48} className="mx-auto mb-4" />
                            <h2 className="text-2xl font-bold">探索者がいません</h2>
                            <p className="mt-2">「新規作成」ボタンで新しい探索者を作成するか、「いあきゃら読込」で既存のキャラクターをインポートしてください。</p>
                        </div>
                    )}
                </div>

                <footer className="mt-6 flex justify-end items-center">
                    <button
                        onClick={() => onCharacterCreate(characters)}
                        disabled={!canStartGame}
                        className="w-full sm:w-auto px-8 py-3 bg-purple-700 hover:bg-purple-600 text-white font-bold text-lg rounded-md transition-all transform hover:scale-105 disabled:bg-gray-700 disabled:text-gray-500 disabled:cursor-not-allowed disabled:scale-100 shadow-lg disabled:shadow-none"
                    >
                        {canStartGame ? "物語を開始する" : "キャラクターを完成させてください"}
                    </button>
                </footer>
            </div>
        </div>
    );
};

// 独自技能作成・編集モーダル
const CustomSkillModal: React.FC<{
    isOpen: boolean;
    editingSkill: CustomSkill | null;
    onSave: (skillData: Omit<CustomSkill, 'id'>) => void;
    onEdit: (skillData: CustomSkill) => void;
    onClose: () => void;
}> = ({ isOpen, editingSkill, onSave, onEdit, onClose }) => {
    const [formData, setFormData] = useState({
        name: '',
        baseValue: 1,
        category: '知識技能'
    });

    useEffect(() => {
        if (editingSkill) {
            setFormData({
                name: editingSkill.name,
                baseValue: editingSkill.baseValue,
                category: editingSkill.category
            });
        } else {
            setFormData({
                name: '',
                baseValue: 1,
                category: '知識技能'
            });
        }
    }, [editingSkill, isOpen]);

    const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
        const { name, value, type } = e.target;
        const processedValue = type === 'number' ? parseInt(value) || 0 : value;
        setFormData(prev => ({ ...prev, [name]: processedValue }));
    };

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (!formData.name.trim()) return;

        if (editingSkill) {
            onEdit({
                ...editingSkill,
                ...formData
            });
        } else {
            onSave(formData);
        }
        onClose();
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-4" onClick={onClose}>
            <div className="bg-gray-800 rounded-lg shadow-xl border border-purple-500/30 w-full max-w-md" onClick={e => e.stopPropagation()}>
                <form onSubmit={handleSubmit}>
                    <div className="p-6">
                        <div className="flex justify-between items-start mb-4">
                            <h2 className="text-2xl font-bold font-crimson text-purple-300">
                                {editingSkill ? '独自技能を編集' : '独自技能を追加'}
                            </h2>
                            <button type="button" onClick={onClose} className="text-gray-400 hover:text-white">
                                <X size={24} />
                            </button>
                        </div>
                        <div className="space-y-4">
                            <div>
                                <label htmlFor="skillName" className="block text-sm font-medium text-gray-300 mb-1">技能名</label>
                                <input 
                                    id="skillName" 
                                    name="name" 
                                    type="text" 
                                    value={formData.name} 
                                    onChange={handleChange} 
                                    required 
                                    className="w-full p-2 bg-gray-700 border border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-purple-400"
                                    placeholder="例：考古学（エジプト）"
                                />
                            </div>
                            <div>
                                <label htmlFor="baseValue" className="block text-sm font-medium text-gray-300 mb-1">初期値</label>
                                <input 
                                    id="baseValue" 
                                    name="baseValue" 
                                    type="number" 
                                    min="0" 
                                    max="99"
                                    value={formData.baseValue} 
                                    onChange={handleChange} 
                                    className="w-full p-2 bg-gray-700 border border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-purple-400"
                                />
                            </div>
                            <div>
                                <label htmlFor="category" className="block text-sm font-medium text-gray-300 mb-1">カテゴリ</label>
                                <select 
                                    id="category" 
                                    name="category" 
                                    value={formData.category} 
                                    onChange={handleChange}
                                    className="w-full p-2 bg-gray-700 border border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-purple-400"
                                >
                                    <option value="戦闘技能">戦闘技能</option>
                                    <option value="探索技能">探索技能</option>
                                    <option value="行動技能">行動技能</option>
                                    <option value="交渉技能">交渉技能</option>
                                    <option value="知識技能">知識技能</option>
                                </select>
                            </div>
                        </div>
                    </div>
                    <div className="bg-gray-900/50 px-6 py-3 flex justify-end gap-4 rounded-b-lg">
                        <button type="button" onClick={onClose} className="px-4 py-2 bg-gray-600 hover:bg-gray-500 text-white font-semibold rounded-md transition-colors">
                            キャンセル
                        </button>
                        <button type="submit" className="px-4 py-2 bg-purple-600 hover:bg-purple-500 text-white font-semibold rounded-md transition-colors">
                            {editingSkill ? '更新' : '追加'}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
};
