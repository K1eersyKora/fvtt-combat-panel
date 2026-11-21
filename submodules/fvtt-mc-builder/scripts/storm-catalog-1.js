import { STYLES } from './kit-catalog-1.js';
export const STORM_STYLE={"id":"stormwreck","label":"风骸岛海崖","color":"#8a8b7e","pattern":"basalt","stone":"#9a998a","basalt":"#747a78","wetrock":"#657b78","moss":"#798765","water":"#478e9a","foam":"#b5ccc3","wood":"#978568","trim":"#675e50","cloth":"#a09178","metal":"#62696a","rune":"#80b0ab","crystalAmber":"#d2a05e","crystalViolet":"#9f91b5"};
export const ALL_STYLES=Object.freeze([...STYLES,STORM_STYLE]);
const RAW=[
  {
    "key": "sw_cliff_straight",
    "label": "玄武岩柱壁",
    "category": "terrain",
    "kind": "solid",
    "use": "连续10尺岩壁；柱纹朝外，顶面可承重",
    "parts": [
      {
        "min": [
          0,
          0,
          0.25
        ],
        "max": [
          1,
          2,
          1
        ],
        "role": "basalt"
      },
      {
        "min": [
          0,
          0,
          0
        ],
        "max": [
          0.3,
          2,
          0.25
        ],
        "role": "basalt"
      },
      {
        "min": [
          0.3,
          0,
          0.1
        ],
        "max": [
          0.65,
          2,
          0.25
        ],
        "role": "wetrock"
      },
      {
        "min": [
          0.65,
          0,
          0.05
        ],
        "max": [
          1,
          2,
          0.25
        ],
        "role": "basalt"
      }
    ]
  },
  {
    "key": "sw_cliff_inner",
    "label": "玄武岩内凹角",
    "category": "terrain",
    "kind": "solid",
    "use": "10尺L形岩壁，保留5×5尺内凹空间",
    "parts": [
      {
        "min": [
          0,
          0,
          0
        ],
        "max": [
          2,
          2,
          1
        ],
        "role": "basalt"
      },
      {
        "min": [
          0,
          0,
          1
        ],
        "max": [
          1,
          2,
          2
        ],
        "role": "basalt"
      },
      {
        "min": [
          1,
          0,
          0.95
        ],
        "max": [
          1.3,
          1.5,
          1
        ],
        "role": "wetrock"
      },
      {
        "min": [
          0.95,
          0,
          1.4
        ],
        "max": [
          1,
          1.5,
          1.8
        ],
        "role": "wetrock"
      }
    ]
  },
  {
    "key": "sw_cliff_outer",
    "label": "玄武岩外凸角",
    "category": "terrain",
    "kind": "solid",
    "use": "阶切外凸崖角；上方完整平台请另铺地板",
    "parts": [
      {
        "min": [
          0,
          0,
          0
        ],
        "max": [
          1,
          2,
          2
        ],
        "role": "basalt"
      },
      {
        "min": [
          1,
          0,
          0
        ],
        "max": [
          2,
          2,
          1
        ],
        "role": "basalt"
      },
      {
        "min": [
          1,
          0,
          1
        ],
        "max": [
          1.5,
          2,
          1.5
        ],
        "role": "basalt"
      },
      {
        "min": [
          1.5,
          0,
          1
        ],
        "max": [
          1.75,
          1.5,
          1.25
        ],
        "role": "basalt"
      },
      {
        "min": [
          1,
          0,
          1.5
        ],
        "max": [
          1.25,
          1.5,
          1.75
        ],
        "role": "basalt"
      }
    ]
  },
  {
    "key": "sw_ledge_5ft",
    "label": "潮间带岩架",
    "category": "terrain",
    "kind": "solid",
    "use": "15尺长、5尺宽、2.5尺高连续平顶；可连接低潮步道",
    "parts": [
      {
        "min": [
          0,
          0.25,
          0
        ],
        "max": [
          3,
          0.5,
          1
        ],
        "role": "wetrock"
      },
      {
        "min": [
          0,
          0,
          0.15
        ],
        "max": [
          0.75,
          0.25,
          1
        ],
        "role": "basalt"
      },
      {
        "min": [
          0.75,
          0.1,
          0.05
        ],
        "max": [
          1.5,
          0.25,
          1
        ],
        "role": "basalt"
      },
      {
        "min": [
          1.5,
          0,
          0.2
        ],
        "max": [
          2.25,
          0.25,
          1
        ],
        "role": "basalt"
      },
      {
        "min": [
          2.25,
          0.1,
          0.1
        ],
        "max": [
          3,
          0.25,
          1
        ],
        "role": "basalt"
      }
    ]
  },
  {
    "key": "sw_cave_portal",
    "label": "玄武岩洞口",
    "category": "terrain",
    "kind": "solid",
    "use": "10尺净宽、15尺净高；左右立柱与顶部保留真实空洞",
    "parts": [
      {
        "min": [
          0,
          0,
          0
        ],
        "max": [
          0.5,
          3,
          1
        ],
        "role": "basalt"
      },
      {
        "min": [
          2.5,
          0,
          0
        ],
        "max": [
          3,
          3,
          1
        ],
        "role": "basalt"
      },
      {
        "min": [
          0,
          3,
          0
        ],
        "max": [
          3,
          3.5,
          1
        ],
        "role": "basalt"
      },
      {
        "min": [
          0.05,
          0,
          0.05
        ],
        "max": [
          0.3,
          2.5,
          0.2
        ],
        "role": "wetrock"
      },
      {
        "min": [
          2.65,
          0,
          0.05
        ],
        "max": [
          2.9,
          2.5,
          0.2
        ],
        "role": "wetrock"
      }
    ]
  },
  {
    "key": "sw_pool_rim",
    "label": "浅池开放岸",
    "category": "terrain",
    "kind": "solid",
    "use": "10×10尺U形池岸；内净宽8尺，开口向东，水位与池底另铺",
    "parts": [
      {
        "min": [
          0,
          0,
          0
        ],
        "max": [
          2,
          0.5,
          0.2
        ],
        "role": "wetrock"
      },
      {
        "min": [
          0,
          0,
          1.8
        ],
        "max": [
          2,
          0.5,
          2
        ],
        "role": "wetrock"
      },
      {
        "min": [
          0,
          0,
          0.2
        ],
        "max": [
          0.2,
          0.5,
          1.8
        ],
        "role": "wetrock"
      },
      {
        "min": [
          0.05,
          0.5,
          0.05
        ],
        "max": [
          1.9,
          0.55,
          0.15
        ],
        "role": "moss"
      },
      {
        "min": [
          0.05,
          0.5,
          1.85
        ],
        "max": [
          1.9,
          0.55,
          1.95
        ],
        "role": "moss"
      }
    ]
  },
  {
    "key": "sw_buttress",
    "label": "阶切崖托",
    "category": "terrain",
    "kind": "solid",
    "use": "10尺高承重岩托，顶端5尺平台；不作为楼梯",
    "parts": [
      {
        "min": [
          0,
          0,
          0
        ],
        "max": [
          2,
          0.5,
          2
        ],
        "role": "basalt"
      },
      {
        "min": [
          0.25,
          0.5,
          0.25
        ],
        "max": [
          1.75,
          1,
          1.75
        ],
        "role": "basalt"
      },
      {
        "min": [
          0.5,
          1,
          0.5
        ],
        "max": [
          1.5,
          1.5,
          1.5
        ],
        "role": "basalt"
      },
      {
        "min": [
          0.5,
          1.5,
          0.5
        ],
        "max": [
          1.5,
          2,
          1.5
        ],
        "role": "wetrock"
      }
    ]
  },
  {
    "key": "sw_wall_ruined",
    "label": "崖顶残墙",
    "category": "architecture",
    "kind": "solid",
    "use": "10尺宽、1尺厚破损墙；高低墙垛提供不同射界",
    "parts": [
      {
        "min": [
          0,
          0,
          0.4
        ],
        "max": [
          2,
          1,
          0.6
        ],
        "role": "stone"
      },
      {
        "min": [
          0,
          1,
          0.4
        ],
        "max": [
          0.5,
          3,
          0.6
        ],
        "role": "stone"
      },
      {
        "min": [
          0.5,
          1,
          0.4
        ],
        "max": [
          1,
          2,
          0.6
        ],
        "role": "stone"
      },
      {
        "min": [
          1,
          1,
          0.4
        ],
        "max": [
          1.5,
          1.5,
          0.6
        ],
        "role": "stone"
      },
      {
        "min": [
          1.5,
          1,
          0.4
        ],
        "max": [
          1.75,
          1.25,
          0.6
        ],
        "role": "stone"
      },
      {
        "min": [
          0,
          0,
          0.35
        ],
        "max": [
          2,
          0.15,
          0.65
        ],
        "role": "trim"
      }
    ]
  },
  {
    "key": "sw_crystal_plug",
    "label": "橙晶堵口",
    "category": "terrain",
    "kind": "solid",
    "use": "完整封住5尺宽、10尺高裂口；GM拆除后才开放通路",
    "parts": [
      {
        "min": [
          0,
          0,
          0.25
        ],
        "max": [
          1,
          2,
          0.75
        ],
        "role": "crystalAmber"
      },
      {
        "min": [
          0.05,
          0,
          0.1
        ],
        "max": [
          0.35,
          1.5,
          0.25
        ],
        "role": "crystalAmber"
      },
      {
        "min": [
          0.35,
          0,
          0
        ],
        "max": [
          0.7,
          1.8,
          0.25
        ],
        "role": "crystalAmber"
      },
      {
        "min": [
          0.7,
          0.15,
          0.1
        ],
        "max": [
          0.95,
          1.35,
          0.25
        ],
        "role": "crystalAmber"
      },
      {
        "min": [
          0.1,
          2,
          0.3
        ],
        "max": [
          0.35,
          2.25,
          0.7
        ],
        "role": "crystalAmber"
      },
      {
        "min": [
          0.45,
          2,
          0.35
        ],
        "max": [
          0.75,
          2.5,
          0.65
        ],
        "role": "crystalAmber"
      }
    ]
  },
  {
    "key": "sw_waterfall",
    "label": "玄武岩瀑布水帘",
    "category": "decor",
    "kind": "decor",
    "use": "5尺宽、10尺高半透明水帘；无阻挡，落脚由岩岸承担",
    "parts": [
      {
        "min": [
          0,
          0,
          0.4
        ],
        "max": [
          1,
          2,
          0.45
        ],
        "role": "water"
      },
      {
        "min": [
          0.1,
          0,
          0.35
        ],
        "max": [
          0.2,
          1.75,
          0.4
        ],
        "role": "foam"
      },
      {
        "min": [
          0.45,
          0,
          0.35
        ],
        "max": [
          0.55,
          2,
          0.4
        ],
        "role": "foam"
      },
      {
        "min": [
          0.8,
          0,
          0.35
        ],
        "max": [
          0.85,
          1.9,
          0.4
        ],
        "role": "foam"
      },
      {
        "min": [
          0,
          0,
          0.05
        ],
        "max": [
          1,
          0.05,
          0.75
        ],
        "role": "foam"
      }
    ]
  },
  {
    "key": "sw_tide_surface",
    "label": "潮水薄面",
    "category": "decor",
    "kind": "decor",
    "use": "10×10尺水面，可按高度摆放；无承重，无自动潮汐或游泳判定",
    "parts": [
      {
        "min": [
          0,
          0,
          0
        ],
        "max": [
          2,
          0.05,
          2
        ],
        "role": "water"
      },
      {
        "min": [
          0.15,
          0.05,
          0.3
        ],
        "max": [
          0.7,
          0.1,
          0.35
        ],
        "role": "foam"
      },
      {
        "min": [
          1.05,
          0.05,
          1.3
        ],
        "max": [
          1.7,
          0.1,
          1.35
        ],
        "role": "foam"
      }
    ]
  },
  {
    "key": "sw_basalt_floor",
    "label": "玄武岩柱顶地面",
    "category": "terrain",
    "kind": "solid",
    "use": "5×5尺连续平顶、2.5尺厚；四分柱缝保持完整落脚面积",
    "parts": [
      {
        "min": [
          0,
          0,
          0
        ],
        "max": [
          1,
          0.25,
          1
        ],
        "role": "basalt"
      },
      {
        "min": [
          0,
          0.25,
          0
        ],
        "max": [
          0.5,
          0.5,
          0.5
        ],
        "role": "wetrock"
      },
      {
        "min": [
          0.5,
          0.25,
          0
        ],
        "max": [
          1,
          0.5,
          0.5
        ],
        "role": "basalt"
      },
      {
        "min": [
          0,
          0.25,
          0.5
        ],
        "max": [
          0.5,
          0.5,
          1
        ],
        "role": "basalt"
      },
      {
        "min": [
          0.5,
          0.25,
          0.5
        ],
        "max": [
          1,
          0.5,
          1
        ],
        "role": "wetrock"
      }
    ]
  },
  {
    "key": "sw_winch_frame",
    "label": "静态绞盘吊架",
    "category": "mechanisms",
    "use": "崖边货运绞盘的静态框架，悬臂下留空可放货盘；不会自动升降",
    "kind": "solid",
    "parts": [
      {
        "min": [
          0,
          0,
          0
        ],
        "max": [
          0.2,
          0.1,
          0.4
        ],
        "role": "trim"
      },
      {
        "min": [
          0,
          0,
          0.6
        ],
        "max": [
          0.2,
          0.1,
          1
        ],
        "role": "trim"
      },
      {
        "min": [
          1,
          0,
          0
        ],
        "max": [
          1.2,
          0.1,
          0.4
        ],
        "role": "trim"
      },
      {
        "min": [
          1,
          0,
          0.6
        ],
        "max": [
          1.2,
          0.1,
          1
        ],
        "role": "trim"
      },
      {
        "min": [
          0,
          0,
          0.4
        ],
        "max": [
          0.2,
          2.4,
          0.6
        ],
        "role": "wood"
      },
      {
        "min": [
          1,
          0,
          0.4
        ],
        "max": [
          1.2,
          2.4,
          0.6
        ],
        "role": "wood"
      },
      {
        "min": [
          0,
          2.4,
          0.4
        ],
        "max": [
          2,
          2.6,
          0.6
        ],
        "role": "wood"
      },
      {
        "min": [
          1.2,
          2.2,
          0.4
        ],
        "max": [
          1.4,
          2.4,
          0.6
        ],
        "role": "trim"
      },
      {
        "min": [
          0.2,
          0.8,
          0.35
        ],
        "max": [
          1,
          1.1,
          0.65
        ],
        "role": "wood"
      },
      {
        "min": [
          1.2,
          0.85,
          0.45
        ],
        "max": [
          1.35,
          1.1,
          0.55
        ],
        "role": "metal"
      },
      {
        "min": [
          1.75,
          1.3,
          0.45
        ],
        "max": [
          1.85,
          2.4,
          0.55
        ],
        "role": "cloth"
      },
      {
        "min": [
          1.7,
          1.2,
          0.4
        ],
        "max": [
          1.9,
          1.3,
          0.6
        ],
        "role": "metal"
      }
    ]
  },
  {
    "key": "sw_cargo_tray",
    "label": "货盘吊台",
    "category": "mechanisms",
    "use": "5尺完整平顶、2.5尺厚的独立货盘；手动摆放高度，不自动运载角色",
    "kind": "solid",
    "parts": [
      {
        "min": [
          0,
          0,
          0
        ],
        "max": [
          1,
          0.5,
          1
        ],
        "role": "wood"
      },
      {
        "min": [
          0.05,
          0.45,
          0
        ],
        "max": [
          0.15,
          0.5,
          1
        ],
        "role": "metal"
      },
      {
        "min": [
          0.85,
          0.45,
          0
        ],
        "max": [
          0.95,
          0.5,
          1
        ],
        "role": "metal"
      }
    ]
  },
  {
    "key": "sw_hammock",
    "label": "吊床",
    "category": "furniture",
    "use": "岩室休息位，两桩间挂布兜；不自动长休",
    "kind": "solid",
    "parts": [
      {
        "min": [
          0.4,
          0,
          0
        ],
        "max": [
          0.6,
          1.2,
          0.15
        ],
        "role": "wood"
      },
      {
        "min": [
          0.4,
          0,
          1.85
        ],
        "max": [
          0.6,
          1.2,
          2
        ],
        "role": "wood"
      },
      {
        "min": [
          0.2,
          0.7,
          0.15
        ],
        "max": [
          0.8,
          0.85,
          0.45
        ],
        "role": "cloth"
      },
      {
        "min": [
          0.15,
          0.6,
          0.45
        ],
        "max": [
          0.85,
          0.75,
          0.75
        ],
        "role": "cloth"
      },
      {
        "min": [
          0.1,
          0.5,
          0.75
        ],
        "max": [
          0.9,
          0.65,
          1.25
        ],
        "role": "cloth"
      },
      {
        "min": [
          0.15,
          0.6,
          1.25
        ],
        "max": [
          0.85,
          0.75,
          1.55
        ],
        "role": "cloth"
      },
      {
        "min": [
          0.2,
          0.7,
          1.55
        ],
        "max": [
          0.8,
          0.85,
          1.85
        ],
        "role": "cloth"
      },
      {
        "min": [
          0.3,
          0.85,
          0.2
        ],
        "max": [
          0.7,
          0.9,
          0.4
        ],
        "role": "paper"
      }
    ]
  },
  {
    "key": "sw_cook_range",
    "label": "紧凑灶台",
    "category": "furniture",
    "use": "厨房矮灶，正面炉膛为真实开口，顶部可放锅；无自动伤害或照明",
    "kind": "solid",
    "parts": [
      {
        "min": [
          0,
          0,
          0
        ],
        "max": [
          0.25,
          0.7,
          1
        ],
        "role": "stone"
      },
      {
        "min": [
          0.75,
          0,
          0
        ],
        "max": [
          1,
          0.7,
          1
        ],
        "role": "stone"
      },
      {
        "min": [
          0.25,
          0,
          0.8
        ],
        "max": [
          0.75,
          0.7,
          1
        ],
        "role": "stone"
      },
      {
        "min": [
          0.25,
          0,
          0
        ],
        "max": [
          0.75,
          0.1,
          0.8
        ],
        "role": "stone"
      },
      {
        "min": [
          0,
          0.7,
          0
        ],
        "max": [
          1,
          0.8,
          1
        ],
        "role": "metal"
      },
      {
        "min": [
          0.35,
          0.1,
          0.2
        ],
        "max": [
          0.65,
          0.25,
          0.6
        ],
        "role": "ember"
      },
      {
        "min": [
          0.3,
          0.8,
          0.2
        ],
        "max": [
          0.7,
          1.05,
          0.6
        ],
        "role": "metal"
      },
      {
        "min": [
          0.4,
          0.8,
          0.8
        ],
        "max": [
          0.6,
          1.5,
          1
        ],
        "role": "stone"
      }
    ]
  },
  {
    "key": "sw_garden_trough",
    "label": "菜园槽",
    "category": "furniture",
    "use": "10尺×5尺石砌种植槽，可作菜园或蘑菇床底座；低矮障碍",
    "kind": "solid",
    "parts": [
      {
        "min": [
          0,
          0,
          0
        ],
        "max": [
          2,
          0.1,
          1
        ],
        "role": "stone"
      },
      {
        "min": [
          0,
          0.1,
          0
        ],
        "max": [
          2,
          0.4,
          0.1
        ],
        "role": "stone"
      },
      {
        "min": [
          0,
          0.1,
          0.9
        ],
        "max": [
          2,
          0.4,
          1
        ],
        "role": "stone"
      },
      {
        "min": [
          0,
          0.1,
          0.1
        ],
        "max": [
          0.1,
          0.4,
          0.9
        ],
        "role": "stone"
      },
      {
        "min": [
          1.9,
          0.1,
          0.1
        ],
        "max": [
          2,
          0.4,
          0.9
        ],
        "role": "stone"
      },
      {
        "min": [
          0.1,
          0.1,
          0.1
        ],
        "max": [
          1.9,
          0.3,
          0.9
        ],
        "role": "moss"
      },
      {
        "min": [
          0.3,
          0.3,
          0.3
        ],
        "max": [
          0.4,
          0.5,
          0.4
        ],
        "role": "moss"
      },
      {
        "min": [
          0.9,
          0.3,
          0.6
        ],
        "max": [
          1,
          0.55,
          0.7
        ],
        "role": "moss"
      },
      {
        "min": [
          1.5,
          0.3,
          0.35
        ],
        "max": [
          1.6,
          0.45,
          0.45
        ],
        "role": "moss"
      }
    ]
  },
  {
    "key": "sw_orrery",
    "label": "体素星象仪",
    "category": "furniture",
    "use": "天文台中央的静态星象仪模型，调查焦点；不会转动，无自动效果",
    "kind": "solid",
    "parts": [
      {
        "min": [
          0.4,
          0,
          0.4
        ],
        "max": [
          1.6,
          0.2,
          1.6
        ],
        "role": "wood"
      },
      {
        "min": [
          0.6,
          0.2,
          0.6
        ],
        "max": [
          1.4,
          0.4,
          1.4
        ],
        "role": "trim"
      },
      {
        "min": [
          0.9,
          0.4,
          0.9
        ],
        "max": [
          1.1,
          1.6,
          1.1
        ],
        "role": "metal"
      },
      {
        "min": [
          0.75,
          1.6,
          0.75
        ],
        "max": [
          1.25,
          2.1,
          1.25
        ],
        "role": "crystalAmber"
      },
      {
        "min": [
          0.3,
          1.3,
          0.95
        ],
        "max": [
          0.9,
          1.4,
          1.05
        ],
        "role": "metal"
      },
      {
        "min": [
          0,
          1.2,
          0.85
        ],
        "max": [
          0.3,
          1.5,
          1.15
        ],
        "role": "crystalViolet"
      },
      {
        "min": [
          1.1,
          1,
          0.95
        ],
        "max": [
          1.7,
          1.1,
          1.05
        ],
        "role": "metal"
      },
      {
        "min": [
          1.7,
          0.9,
          0.85
        ],
        "max": [
          2,
          1.2,
          1.15
        ],
        "role": "rune"
      },
      {
        "min": [
          0.95,
          0.7,
          0.3
        ],
        "max": [
          1.05,
          0.8,
          0.9
        ],
        "role": "metal"
      },
      {
        "min": [
          0.85,
          0.6,
          0
        ],
        "max": [
          1.15,
          0.9,
          0.3
        ],
        "role": "rune"
      },
      {
        "min": [
          0.95,
          1.45,
          1.1
        ],
        "max": [
          1.05,
          1.55,
          1.7
        ],
        "role": "metal"
      },
      {
        "min": [
          0.9,
          1.4,
          1.7
        ],
        "max": [
          1.1,
          1.6,
          1.9
        ],
        "role": "stone"
      }
    ]
  },
  {
    "key": "sw_chart_overlay",
    "label": "星图桌面配件",
    "category": "decor",
    "use": "摆在现有长桌桌面上的星图、卷轴与镇纸；纯装饰线索标记",
    "kind": "decor",
    "parts": [
      {
        "min": [
          0.1,
          0,
          0.15
        ],
        "max": [
          0.9,
          0.05,
          0.85
        ],
        "role": "paper"
      },
      {
        "min": [
          0.25,
          0.05,
          0.3
        ],
        "max": [
          0.35,
          0.1,
          0.4
        ],
        "role": "rune"
      },
      {
        "min": [
          0.5,
          0.05,
          0.5
        ],
        "max": [
          0.6,
          0.1,
          0.6
        ],
        "role": "rune"
      },
      {
        "min": [
          0.65,
          0.05,
          0.3
        ],
        "max": [
          0.7,
          0.1,
          0.35
        ],
        "role": "crystalAmber"
      },
      {
        "min": [
          0.1,
          0.05,
          0.75
        ],
        "max": [
          0.7,
          0.15,
          0.85
        ],
        "role": "paper"
      },
      {
        "min": [
          0.8,
          0.05,
          0.2
        ],
        "max": [
          0.9,
          0.15,
          0.3
        ],
        "role": "metal"
      }
    ]
  },
  {
    "key": "sw_broken_trim",
    "label": "破损护墙",
    "category": "architecture",
    "use": "天文台边缘残缺护墙，高低不齐的掩护与缺口；遮挡由几何决定",
    "kind": "solid",
    "parts": [
      {
        "min": [
          0,
          0,
          0.3
        ],
        "max": [
          1,
          0.3,
          0.7
        ],
        "role": "stone"
      },
      {
        "min": [
          0,
          0.3,
          0.3
        ],
        "max": [
          0.35,
          0.8,
          0.7
        ],
        "role": "stone"
      },
      {
        "min": [
          0.35,
          0.3,
          0.3
        ],
        "max": [
          0.6,
          0.5,
          0.7
        ],
        "role": "stone"
      },
      {
        "min": [
          0,
          0.8,
          0.25
        ],
        "max": [
          0.35,
          0.9,
          0.75
        ],
        "role": "trim"
      },
      {
        "min": [
          0.6,
          0,
          0.7
        ],
        "max": [
          0.9,
          0.2,
          0.9
        ],
        "role": "stone"
      }
    ]
  },
  {
    "key": "sw_roof_rib",
    "label": "断裂拱肋",
    "category": "architecture",
    "use": "坍塌屋顶残留的墩柱与悬挑断肋，下方可通行；仅表现废墟轮廓",
    "kind": "solid",
    "parts": [
      {
        "min": [
          0,
          0,
          0.35
        ],
        "max": [
          0.3,
          2,
          0.65
        ],
        "role": "stone"
      },
      {
        "min": [
          0,
          0,
          0.3
        ],
        "max": [
          0.3,
          0.15,
          0.35
        ],
        "role": "trim"
      },
      {
        "min": [
          0.3,
          1.7,
          0.35
        ],
        "max": [
          0.6,
          2,
          0.65
        ],
        "role": "stone"
      },
      {
        "min": [
          0.6,
          1.9,
          0.35
        ],
        "max": [
          0.9,
          2.2,
          0.65
        ],
        "role": "trim"
      },
      {
        "min": [
          0.9,
          2.1,
          0.35
        ],
        "max": [
          1.2,
          2.3,
          0.65
        ],
        "role": "stone"
      }
    ]
  },
  {
    "key": "sw_crystal_cluster_violet",
    "label": "发光紫晶簇",
    "category": "decor",
    "use": "洞穴地面发光小晶簇，仅自发光材质；不阻挡",
    "kind": "decor",
    "parts": [
      {
        "min": [
          0.2,
          0,
          0.2
        ],
        "max": [
          0.8,
          0.1,
          0.8
        ],
        "role": "basalt"
      },
      {
        "min": [
          0.25,
          0.1,
          0.3
        ],
        "max": [
          0.4,
          0.6,
          0.45
        ],
        "role": "crystalViolet"
      },
      {
        "min": [
          0.45,
          0.1,
          0.45
        ],
        "max": [
          0.65,
          0.9,
          0.65
        ],
        "role": "crystalViolet"
      },
      {
        "min": [
          0.6,
          0.1,
          0.25
        ],
        "max": [
          0.75,
          0.45,
          0.4
        ],
        "role": "crystalViolet"
      },
      {
        "min": [
          0.3,
          0.1,
          0.6
        ],
        "max": [
          0.45,
          0.35,
          0.75
        ],
        "role": "rune"
      }
    ]
  },
  {
    "key": "sw_fume_vent",
    "label": "紫雾裂口",
    "category": "terrain",
    "use": "玄武岩环绕的喷气裂口，中心为真实凹孔；烟雾效果与伤害由主持人描述判定",
    "kind": "solid",
    "parts": [
      {
        "min": [
          0.1,
          0,
          0.1
        ],
        "max": [
          0.9,
          0.2,
          0.35
        ],
        "role": "basalt"
      },
      {
        "min": [
          0.1,
          0,
          0.65
        ],
        "max": [
          0.9,
          0.2,
          0.9
        ],
        "role": "basalt"
      },
      {
        "min": [
          0.1,
          0,
          0.35
        ],
        "max": [
          0.35,
          0.2,
          0.65
        ],
        "role": "basalt"
      },
      {
        "min": [
          0.65,
          0,
          0.35
        ],
        "max": [
          0.9,
          0.2,
          0.65
        ],
        "role": "basalt"
      },
      {
        "min": [
          0.35,
          0,
          0.35
        ],
        "max": [
          0.65,
          0.05,
          0.65
        ],
        "role": "crystalViolet"
      },
      {
        "min": [
          0.1,
          0.2,
          0.1
        ],
        "max": [
          0.4,
          0.35,
          0.35
        ],
        "role": "basalt"
      },
      {
        "min": [
          0.6,
          0.2,
          0.7
        ],
        "max": [
          0.9,
          0.3,
          0.9
        ],
        "role": "basalt"
      }
    ]
  },
  {
    "key": "sw_obsidian_egg",
    "label": "黑曜石蛋",
    "category": "decor",
    "use": "约2尺高的黑曜石蛋任务物件标记；不阻挡，无自动效果",
    "kind": "decor",
    "parts": [
      {
        "min": [
          0.35,
          0,
          0.35
        ],
        "max": [
          0.65,
          0.05,
          0.65
        ],
        "role": "basalt"
      },
      {
        "min": [
          0.3,
          0.05,
          0.3
        ],
        "max": [
          0.7,
          0.3,
          0.7
        ],
        "role": "basalt"
      },
      {
        "min": [
          0.35,
          0.3,
          0.35
        ],
        "max": [
          0.65,
          0.4,
          0.65
        ],
        "role": "basalt"
      },
      {
        "min": [
          0.45,
          0.35,
          0.45
        ],
        "max": [
          0.55,
          0.4,
          0.55
        ],
        "role": "crystalViolet"
      }
    ]
  },
  {
    "key": "sw_fungus_small",
    "label": "小型真菌立牌",
    "category": "decor",
    "use": "蘑菇床与洞穴点缀的2D立牌；不阻挡",
    "kind": "decor",
    "parts": [
      {
        "min": [
          0,
          0,
          0
        ],
        "max": [
          1,
          1,
          1
        ],
        "role": "spriteBounds"
      }
    ],
    "sprite": {
      "asset": "fungus",
      "width": 1,
      "height": 1,
      "tint": "#c98a4b"
    }
  },
  {
    "key": "sw_fungus_tall",
    "label": "高型真菌立牌",
    "category": "decor",
    "use": "高大蘑菇2D立牌（外观变体）；不阻挡",
    "kind": "decor",
    "parts": [
      {
        "min": [
          0,
          0,
          0
        ],
        "max": [
          1,
          2,
          1
        ],
        "role": "spriteBounds"
      }
    ],
    "sprite": {
      "asset": "fungus",
      "width": 1,
      "height": 2,
      "tint": "#b9793f"
    }
  },
  {
    "key": "sw_fungus_glow",
    "label": "发光真菌立牌",
    "category": "decor",
    "use": "B5发光真菌2D立牌（外观变体）；不阻挡，无自动照明",
    "kind": "decor",
    "parts": [
      {
        "min": [
          0,
          0,
          0
        ],
        "max": [
          1,
          1,
          1
        ],
        "role": "spriteBounds"
      }
    ],
    "sprite": {
      "asset": "fungus",
      "width": 1,
      "height": 1,
      "tint": "#7fd6c8"
    }
  },
  {
    "key": "sw_fungus_brain",
    "label": "红色真菌线索立牌",
    "category": "decor",
    "use": "红玉肚菌位置标记，沿用真菌2D图像着色；无自动效果",
    "kind": "decor",
    "parts": [
      {
        "min": [
          0,
          0,
          0
        ],
        "max": [
          1,
          1,
          1
        ],
        "role": "spriteBounds"
      }
    ],
    "sprite": {
      "asset": "fungus",
      "width": 1,
      "height": 1,
      "tint": "#b8433c"
    }
  },
  {
    "key": "sw_dragon_statue",
    "label": "龙雕像立牌",
    "category": "decor",
    "use": "神龛龙形雕像2D立牌；纯装饰，不阻挡",
    "kind": "decor",
    "parts": [
      {
        "min": [
          0,
          0,
          0
        ],
        "max": [
          2,
          2,
          2
        ],
        "role": "spriteBounds"
      }
    ],
    "sprite": {
      "asset": "dragon",
      "width": 2,
      "height": 2,
      "tint": "#a9aaa2"
    }
  },
  {
    "key": "sw_scholar_statue",
    "label": "老者雕像立牌",
    "category": "decor",
    "use": "神龛老人雕像2D立牌；纯装饰，不阻挡",
    "kind": "decor",
    "parts": [
      {
        "min": [
          0,
          0,
          0
        ],
        "max": [
          1,
          2,
          1
        ],
        "role": "spriteBounds"
      }
    ],
    "sprite": {
      "asset": "scholar",
      "width": 1,
      "height": 2,
      "tint": "#b3b0a4"
    }
  },
  {
    "key": "sw_garden_tree",
    "label": "树木立牌",
    "category": "decor",
    "use": "菜园与D1岬角树木2D立牌；不阻挡",
    "kind": "decor",
    "parts": [
      {
        "min": [
          0,
          0,
          0
        ],
        "max": [
          2,
          2,
          2
        ],
        "role": "spriteBounds"
      }
    ],
    "sprite": {
      "asset": "tree",
      "width": 2,
      "height": 2,
      "tint": "#5f8a4e"
    }
  },
  {
    "key": "sw_compost",
    "label": "腐烂植物堆肥床",
    "category": "decor",
    "use": "B3腐烂植物堆肥床，5×5尺低矮不规则，纯装饰不阻挡，贴地摆放",
    "kind": "decor",
    "parts": [
      {
        "min": [
          0.1,
          0,
          0.1
        ],
        "max": [
          0.9,
          0.05,
          0.9
        ],
        "role": "basalt"
      },
      {
        "min": [
          0,
          0,
          0.1
        ],
        "max": [
          0.1,
          0.2,
          0.8
        ],
        "role": "wood"
      },
      {
        "min": [
          0.15,
          0,
          0
        ],
        "max": [
          0.9,
          0.15,
          0.1
        ],
        "role": "wood"
      },
      {
        "min": [
          0.9,
          0,
          0.3
        ],
        "max": [
          1,
          0.25,
          0.95
        ],
        "role": "wood"
      },
      {
        "min": [
          0,
          0,
          0.8
        ],
        "max": [
          0.2,
          0.15,
          1
        ],
        "role": "basalt"
      },
      {
        "min": [
          0.9,
          0,
          0
        ],
        "max": [
          1,
          0.1,
          0.25
        ],
        "role": "basalt"
      },
      {
        "min": [
          0.1,
          0.05,
          0.1
        ],
        "max": [
          0.9,
          0.2,
          0.9
        ],
        "role": "moss"
      },
      {
        "min": [
          0.2,
          0.2,
          0.25
        ],
        "max": [
          0.75,
          0.3,
          0.8
        ],
        "role": "moss"
      },
      {
        "min": [
          0.35,
          0.3,
          0.4
        ],
        "max": [
          0.6,
          0.4,
          0.65
        ],
        "role": "moss"
      },
      {
        "min": [
          0.3,
          0,
          0.9
        ],
        "max": [
          0.7,
          0.1,
          1
        ],
        "role": "moss"
      },
      {
        "min": [
          0.05,
          0.2,
          0.3
        ],
        "max": [
          0.15,
          0.25,
          0.55
        ],
        "role": "moss"
      },
      {
        "min": [
          0.6,
          0.2,
          0.15
        ],
        "max": [
          0.85,
          0.3,
          0.25
        ],
        "role": "wood"
      },
      {
        "min": [
          0.25,
          0.3,
          0.6
        ],
        "max": [
          0.3,
          0.5,
          0.65
        ],
        "role": "wood"
      },
      {
        "min": [
          0.7,
          0.2,
          0.6
        ],
        "max": [
          0.85,
          0.3,
          0.75
        ],
        "role": "basalt"
      }
    ]
  },
  {
    "key": "sw_ceiling_nest",
    "label": "胶质蚊蝠巢（洞顶）",
    "category": "decor",
    "use": "B3洞顶西南角胶质蚊蝠巢，10×5尺、垂挂1.5单位，不含怪物，纯装饰不阻挡；摆放高度=洞顶高度-1.5，使局部y=1.5贴洞顶",
    "kind": "decor",
    "parts": [
      {
        "min": [
          0.1,
          1.4,
          0.05
        ],
        "max": [
          1.9,
          1.5,
          0.95
        ],
        "role": "wetrock"
      },
      {
        "min": [
          0,
          1.25,
          0.35
        ],
        "max": [
          0.1,
          1.5,
          0.65
        ],
        "role": "wetrock"
      },
      {
        "min": [
          0.2,
          1.1,
          0.1
        ],
        "max": [
          1.8,
          1.4,
          0.9
        ],
        "role": "cloth"
      },
      {
        "min": [
          0.35,
          0.7,
          0.2
        ],
        "max": [
          1.65,
          1.1,
          0.8
        ],
        "role": "cloth"
      },
      {
        "min": [
          0.15,
          0.85,
          0.3
        ],
        "max": [
          0.35,
          1.1,
          0.7
        ],
        "role": "cloth"
      },
      {
        "min": [
          0.6,
          0.4,
          0.3
        ],
        "max": [
          1.3,
          0.7,
          0.7
        ],
        "role": "cloth"
      },
      {
        "min": [
          0.85,
          0.15,
          0.4
        ],
        "max": [
          1.1,
          0.4,
          0.6
        ],
        "role": "cloth"
      },
      {
        "min": [
          0.3,
          0.95,
          0.15
        ],
        "max": [
          1.7,
          1,
          0.85
        ],
        "role": "trim"
      },
      {
        "min": [
          0.95,
          0,
          0.45
        ],
        "max": [
          1,
          0.15,
          0.5
        ],
        "role": "trim"
      },
      {
        "min": [
          0.1,
          0.8,
          0.45
        ],
        "max": [
          0.15,
          1.4,
          0.5
        ],
        "role": "trim"
      },
      {
        "min": [
          1.85,
          0.9,
          0.3
        ],
        "max": [
          1.9,
          1.4,
          0.35
        ],
        "role": "trim"
      },
      {
        "min": [
          0.5,
          0.75,
          0.8
        ],
        "max": [
          1.2,
          0.95,
          0.85
        ],
        "role": "paper"
      },
      {
        "min": [
          0.9,
          0.75,
          0.15
        ],
        "max": [
          1.5,
          0.95,
          0.2
        ],
        "role": "paper"
      },
      {
        "min": [
          1.4,
          0.5,
          0.35
        ],
        "max": [
          1.7,
          0.7,
          0.65
        ],
        "role": "paper"
      },
      {
        "min": [
          0.7,
          0.8,
          0.85
        ],
        "max": [
          0.9,
          0.9,
          0.9
        ],
        "role": "trim"
      },
      {
        "min": [
          0.55,
          0.3,
          0.25
        ],
        "max": [
          0.75,
          0.45,
          0.3
        ],
        "role": "paper"
      },
      {
        "min": [
          1.5,
          0.3,
          0.5
        ],
        "max": [
          1.55,
          0.5,
          0.55
        ],
        "role": "trim"
      }
    ]
  }
];
export const STORM_CATALOG=Object.freeze(RAW.map((d,i)=>{const min=[0,1,2].map(a=>Math.min(...d.parts.map(p=>p.min[a]))),max=[0,1,2].map(a=>Math.max(...d.parts.map(p=>p.max[a])));return {...d,id:145+i,shortLabel:d.label,label:d.label+'·风骸岛',style:'stormwreck',color:STORM_STYLE.color,shape:d.key,height:max[1],extent:max.map((n,a)=>+(n-min[a]).toFixed(4)),collision:d.kind==='solid',sight:d.kind==='solid',rotate:true,kit:true};}));
