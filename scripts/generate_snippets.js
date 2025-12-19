// Generates/updates snippet entries in snippets/ini.json from rulesmd.ini based on a provided mapping.
// Key format: "CODE 中文名配置" with { prefix: code.toLowerCase(), body: [...], description: "CODE 中文名" }
// 用于从 rulesmd.ini 根据提供的映射生成/更新 snippets/ini.json 中的代码片段条目。

const fs = require('fs');
const path = require('path');
const { pinyin } = require('pinyin');

const workspace = path.resolve(__dirname, '..');
const snippetsPath = path.join(workspace, 'snippets', 'ini.json');

// Allow overriding rulesmd.ini path via CLI arg or env RULES_PATH
const argRulesIndex = process.argv.indexOf('--rules');
const cliRulesPath = argRulesIndex !== -1 ? process.argv[argRulesIndex + 1] : null;
const envRulesPath = process.env.RULES_PATH;
const rulesPath = path.resolve(cliRulesPath || envRulesPath || path.join(workspace, 'rulesmd.ini'));

function readFileSafe(p) {
    if (!fs.existsSync(p)) throw new Error(`File not found: ${p}`);
    return fs.readFileSync(p, 'utf8');
}

function writeFileSafe(p, content) {
    fs.writeFileSync(p, content, 'utf8');
}

function extractSection(text, code) {
    const header = `[${code}]`;
    const lines = text.split(/\r?\n/);
    let start = -1;
    for (let i = 0; i < lines.length; i++) {
        const trimmed = lines[i].trimStart();
        if (trimmed.startsWith(header) && !trimmed.startsWith(';')) {
            start = i;
            break;
        }
    }
    if (start === -1) return null;
    let end = lines.length;
    for (let j = start + 1; j < lines.length; j++) {
        const t = lines[j].trimStart();
        if (t.startsWith('[') && !t.startsWith(';[')) {
            end = j;
            break;
        }
    }
    const slice = lines.slice(start, end).filter(l => l.trim().length > 0);
    return slice;
}

function toChineseKey(code, name) {
    return `${code} ${name}配置`;
}

function toDescription(code, name) {
    return `${code} ${name}`;
}

// Mapping from the user-provided list
const mapping = {
    "ARND": "终结者",
    "STLN": "蓝波",
    "CLNT": "快枪手",
    "LUNR": "月球飞行兵",
    "E1": "美国大兵",
    "ADOG": "盟军警犬",
    "ENGINEER": "盟军工程师",
    "GGI": "重装大兵",
    "JUMPJET": "火箭飞行兵",
    "SPY": "间谍",
    "GHOST": "海豹部队",
    "TANY": "谭雅",
    "CLEG": "超时空军团兵",
    "CCOMAND": "超时空突击队",
    "PTROOP": "心灵突击队",
    "SNIPE": "狙击手",
    "E2": "动员兵",
    "DOG": "苏军警犬",
    "FLAKT": "防空步兵",
    "SENGINEER": "苏军工程师",
    "SHK": "磁爆步兵",
    "IVAN": "疯狂伊文",
    "BORIS": "鲍裏斯",
    "CIVAN": "超时空伊文",
    "TERROR": "恐怖分子",
    "DESO": "辐射工兵",
    "INIT": "尤里新兵",
    "SLAV": "奴隶矿工",
    "YENGINEER": "尤里工程师",
    "BRUTE": "狂兽人",
    "VIRUS": "病毒狙击手",
    "YURI": "克隆尤里",
    "YURIPR": "尤里X/尤里改",
    "YURIPT": "心灵突击队",
    "CIV1": "平民－黄衣服女",
    "CIV2": "平民－白衣服",
    "CIV3": "平民－技师",
    "CIVA": "平民－工人样",
    "CIVB": "平民－牛仔",
    "CIVC": "平民－黑衣蓝裤",
    "CIVBBP": "平民－棒球员",
    "CIVBFM": "平民－海滩胖男",
    "CIVBF": "平民－海滩女",
    "CIVBTM": "平民－海滩瘦男",
    "CIVSFM": "平民－老人",
    "CIVSF": "平民－红衣服女",
    "CIVSTM": "平民－黑衣服",
    "VLADIMIR": "黄衣服将军",
    "PENTGEN": "绿衣服将军",
    "CTECH": "苏联卫兵",
    "WEEDGUY": "苏联卫兵",
    "CAML": "骆驼",
    "COW": "奶牛",
    "ALL": "鄂鱼",
    "POLARB": "北极熊",
    "DNOA": "暴龙",
    "DNOB": "腕龙",
    "JOSH": "猴",
    "SSRV": "终级保镖",
    "PRES": "总统",
    "RMNV": "洛马诺夫总理",
    "EINS": "爱因斯坦",
    "MUMY": "木乃伊",
    "WWLF": "木乃伊",
    "MTNK": "灰熊坦克",
    "FV": "多功能步兵车",
    "MGTK": "幻影坦克",
    "SREF": "光棱坦克",
    "BFRT": "战斗要塞",
    "AMCV": "盟军基地车",
    "CMON": "超时空矿车（倒矿)",
    "CMIN": "超时空矿车",
    "ROBO": "机器人坦克",
    "TNKD": "坦克杀手",
    "HOWI": "榴弹炮",
    "DRON": "恐怖机器人",
    "HTK": "防空车",
    "HTNK": "犀牛坦克",
    "V3": "V3火箭发射车",
    "APOC": "天启坦克",
    "SMCV": "苏军基地车",
    "HORV": "苏军矿车（倒矿）",
    "HARV": "苏军矿车",
    "TTNK": "磁爆坦克",
    "DTRUCK": "自爆卡车",
    "LTNK": "狂风坦克",
    "YTNK": "格林机炮坦克",
    "TELE": "磁电坦克",
    "MIND": "策划者",
    "DISK": "镭射幽浮",
    "CAOS": "神经突击车",
    "PCV": "尤里基地车",
    "SMON": "奴隶矿车[卸矿]",
    "SMIN": "奴隶矿车",
    "CAR": "汽车－黄色",
    "EUROC": "汽车－黑色",
    "SUVB": "汽车－包厢型",
    "STANG": "汽车－跑车型",
    "SUVW": "汽车－包厢型",
    "BUS": "校车",
    "WINI": "野营车",
    "PICK": "小货车－东风型",
    "PTRUCK": "小货车－皮卡型",
    "TRUCKA": "卡车－自爆卡车型",
    "JEEP": "卡车",
    "TRUCKB": "卡车（载货)东风型",
    "LIMO": "豪华轿车",
    "TAXI": "计程车",
    "COP": "警车",
    "CONA": "挖土机",
    "PROPA": "宣传车",
    "DDBX": "巴士",
    "BCAB": "黑色计程车",
    "YCAB": "黄色计程车",
    "DOLY": "摄影车",
    "CBLC": "电车",
    "FTRK": "救火车",
    "AMBU": "救护车",
    "LCRF": "盟军气垫艇",
    "DEST": "驱逐舰",
    "DLPH": "海豚",
    "AEGIS": "神盾巡洋舰",
    "CARRIER": "航空母舰",
    "SAPC": "苏军气垫船",
    "HYD": "海蝎",
    "SUB": "台风潜艇",
    "SQD": "巨型乌贼",
    "DRED": "无畏级战舰",
    "YHVR": "尤里气垫船",
    "BSUB": "雷鸣潜艇",
    "CDEST": "海岸巡逻船",
    "TUG": "拖船",
    "CRUISE": "游船",
    "CARRIERB": "尼米兹号航空母舰",
    "DREDB": "将军无畏级战舰",
    "VLAD": "维拉迪摩指挥舰",
    "SHAD": "夜鹰直升机",
    "ORCA": "入侵者战机",
    "ASW": "舰载反潜机",
    "HORNET": "大黄蜂",
    "BEAG": "黑鹰战机",
    "SCHP": "围攻直升机",
    "ZEP": "基洛夫飞艇",
    "BPLN": "米格战机",
    "SPYP": "间谍飞机",
    "V3ROCKET": "V3火箭",
    "DMISL": "无畏级导弹",
    "CMISL": "雷鸣导弹",
    "PDPLANE": "运输机",
    "GAPOWR": "盟军发电厂",
    "GAREFN": "盟军矿厂",
    "GAPILE": "盟军兵营",
    "GAWEAP": "盟军兵工厂",
    "GAAIRC": "盟军空军指挥部",
    "AMRADR": "美国空军指挥部",
    "GADEPT": "盟军维修厂",
    "GAYARD": "盟军船厂",
    "GATECH": "盟军实验室",
    "GAROBO": "控制中心",
    "GAOREP": "矿石精鍊器",
    "GAWALL": "盟军围墙",
    "GAPILL": "机枪碉堡",
    "NASAM": "爱国者飞弹",
    "GAGAP": "裂缝产生器",
    "ATESLA": "光棱塔",
    "GASPYSAT": "间谍卫星",
    "GACNST": "盟军建造场",
    "GTGCAN": "法国巨炮",
    "GACSPH": "超时空传送仪",
    "GAWEAT": "天气控制器",
    "NAPOWR": "磁能反应炉",
    "NAREFN": "苏军矿厂",
    "NAHAND": "苏军兵营",
    "NAWEAP": "苏军兵工厂",
    "NARADR": "苏军雷达",
    "NADEPT": "苏军维修厂",
    "NAYARD": "苏军造船厂",
    "NATECH": "苏军实验室",
    "NANRCT": "核子反应堆",
    "NAINDP": "工业工厂",
    "NAWALL": "苏军围墙",
    "NABNKR": "战斗碉堡",
    "NALASR": "哨戒炮",
    "NAFLAK": "防空炮",
    "TESLA": "磁暴线圈",
    "NACNST": "苏军建造厂",
    "NAIRON": "铁幕",
    "NAMISL": "核弹发射井",
    "YAPOWR": "生化反应炉",
    "YAREFN": "奴隶矿厂",
    "YABRCK": "尤里兵营",
    "YAWEAP": "尤里兵工厂",
    "NAPSIS": "心灵感应器",
    "YAYARD": "尤里船厂",
    "YAGRND": "部队回收厂",
    "YATECH": "尤里实验室",
    "GAFWLL": "尤里围墙",
    "NATBNK": "坦克碉堡",
    "YAGGUN": "盖特机炮",
    "YAPSYT": "心灵控制塔",
    "NACLON": "复制中心",
    "YAGNTC": "基因突变器",
    "YAPPET": "心灵控制器",
    "YACNST": "尤里建造场",
    "GASAND": "沙墙",
    "CAAIRP": "科技机场",
    "CAOILD": "科技钻油厂",
    "CAHOSP": "市民医院",
    "CAMACH": "科技机器商店",
    "CAOUTP": "科技前哨站",
    "CAPOWR": "科技电厂",
    "CASLAB": "秘密科技实验室",
    "CATHOSP": "科技医院",
    "CATIME01": "时间机器",
    "CATIME02": "时间机器",
    "CALAB": "爱因斯坦实验室",
    "GATE1": "闸门",
    "CABUNK01": "燃料库",
    "CABUNK02": "燃料库",
    "CABUNK03": "燃料库",
    "CABUNK04": "燃料库",
    "CABHUT": "桥梁维修小屋",
    "CAGARD01": "警卫哨",
    "CAMIAM04": "救生员休息亭",
    "CAUSFGL": "美国国旗",
    "CACUFGL": "古巴国旗",
    "CAFRFGL": "法国国旗",
    "CAGEFGL": "德国国旗",
    "CAIRFGL": "伊拉克国旗",
    "CALBFGL": "利比亚国旗",
    "CARUFGL": "俄国国旗",
    "CAUKFGL": "英国国旗",
    "CASKFGL": "韩国国旗",
    "CALOND04": "英国国会",
    "CALOND05": "大笨钟",
    "CALOND06": "伦敦塔",
    "CAMORR06": "理克酒馆",
    "CAEGYP01": "金字塔",
    "CAEGYP02": "金字塔",
    "CAEGYP03": "金字塔/人面狮身像",
    "CASEAT01": "西雅图太空针塔",
    "CASEAT02": "巨软园区",
    "CASTL04": "拱门",
    "CASYDN03": "雪梨歌剧院",
    "CAEAST01": "复活岛石像",
    "CAEAST02": "尤里雕像",
    "CATRAN03": "尤里要塞",
    "CALUNR01": "登月小艇",
    "CAMIAM08": "亚历桑那纪念馆",
    "CAPRS03": "世界惊奇博物馆",
    "CACHIG04": "芝加哥协会大楼",
    "CAEURO05": "雕像",
    "CAFARM06": "灯塔",
    "CAPARS01": "艾菲尔铁塔",
    "CAPARS11": "巴黎凯旋门",
    "CAWASH14": "杰佛逊纪念馆",
    "CAWASH19": "胜利纪念碑",
    "CAWASH15": "林肯纪念馆",
    "CARUS03": "克里姆林宫",
    "CAWASH01": "白宫",
    "CATRAN01": "地窖",
    "CACOLO01": "空军学院礼拜堂",
    "CARUS08": "球状戏院",
    "CARUS09": "球状戏院",
    "CARUS10": "球状戏院",
    "CARUS11": "球状戏院",
    "CAMISC06": "V3 飞弹",
    "CAARMY01": "军队营帐",
    "CAARMY02": "军队营帐",
    "CAARMY03": "军队营帐",
    "CAARMY04": "军队营帐",
    "CAFRMB": "移动式厕所",
    "CATECH01": "通讯中心",
    "AMMOCRAT": "弹药箱",
    "CAMISC01": "油桶",
    "CAMISC02": "油桶"
};

function main() {
    const rules = readFileSafe(rulesPath);
    let snippetsRaw = readFileSafe(snippetsPath);
    // Strip BOM if present
    if (snippetsRaw.charCodeAt(0) === 0xFEFF) {
        snippetsRaw = snippetsRaw.slice(1);
    }
    // Also trim leading whitespace/newlines
    snippetsRaw = snippetsRaw.replace(/^\s+/, '');
    let snippets;
    try {
        snippets = JSON.parse(snippetsRaw);
    } catch (e) {
        throw new Error('snippets/ini.json is not valid JSON: ' + e.message);
    }

    const added = [];
    const missing = [];
    for (const [code, name] of Object.entries(mapping)) {
        const body = extractSection(rules, code);
        if (!body) {
            missing.push(code);
            continue;
        }
        const key = toChineseKey(code, name);

        // Generate prefix array with code + Chinese keywords + pinyin
        const prefixes = [code.toLowerCase()];

        // Add Chinese name parts as prefixes
        const nameParts = name.split(/[－\-/\s]+/).filter(p => p.length > 0);
        for (const part of nameParts) {
            // Skip pure punctuation and short parts
            if (part.length >= 2 && !prefixes.includes(part)) {
                prefixes.push(part);
            }
        }

        // Add pinyin prefixes (full and initials)
        const pinyinFull = pinyin(name, { style: pinyin.STYLE_NORMAL }).flat().join('');
        const pinyinInitials = pinyin(name, { style: pinyin.STYLE_FIRST_LETTER }).flat().join('');

        if (pinyinFull && !prefixes.includes(pinyinFull)) {
            prefixes.push(pinyinFull);
        }
        if (pinyinInitials && pinyinInitials !== pinyinFull && !prefixes.includes(pinyinInitials)) {
            prefixes.push(pinyinInitials);
        }

        const entry = {
            prefix: prefixes,
            body,
            description: toDescription(code, name)
        };
        // If E1 Chinese entry already exists, keep curated content
        if (code === 'E1' && Object.prototype.hasOwnProperty.call(snippets, key)) {
            // Do not overwrite curated E1
        } else {
            snippets[key] = entry;
        }
        // Remove legacy plain-English key if exists (e.g., "ARND") to enforce naming style
        if (Object.prototype.hasOwnProperty.call(snippets, code)) {
            delete snippets[code];
        }
        added.push(code);
    }

    const backupPath = snippetsPath + '.bak.auto';
    writeFileSafe(backupPath, snippetsRaw);
    writeFileSafe(snippetsPath, JSON.stringify(snippets, null, 2) + '\n');

    console.log('Snippets updated. Added/Updated:', added.length);
    if (missing.length) {
        console.log('Sections not found in rulesmd.ini:', missing.join(', '));
    } else {
        console.log('All requested sections found.');
    }
}

if (require.main === module) {
    try {
        main();
    } catch (err) {
        console.error('Error:', err && err.stack || err);
        process.exit(1);
    }
}
