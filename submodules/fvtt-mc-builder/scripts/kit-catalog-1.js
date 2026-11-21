// Original voxel kit. Units are 5 ft; details use the shared 0.25 ft lattice.
// Functions below are geometry/scene semantics, not automatic D&D adjudication.
export const STYLES = Object.freeze([
  { id: 'village', label: '暖木村镇', color: '#a98252', pattern: 'timber', stone: '#9e9984', wood: '#997143', trim: '#5e4934', cloth: '#a65442', metal: '#5a605c', rune: '#d9ae60' },
  { id: 'dungeon', label: '灰石地牢', color: '#858c8d', pattern: 'brick', stone: '#8a8e87', wood: '#685d49', trim: '#484d4e', cloth: '#657477', metal: '#414c51', rune: '#9cbaaf' },
  { id: 'ruins', label: '砂岩遗迹', color: '#c4ac79', pattern: 'sandstone', stone: '#c3ab7a', wood: '#93805b', trim: '#997347', cloth: '#66837b', metal: '#777350', rune: '#5e998c' },
  { id: 'arcane', label: '暗岩秘法', color: '#69647f', pattern: 'runes', stone: '#656276', wood: '#63566d', trim: '#343b50', cloth: '#766194', metal: '#747c8f', rune: '#66bfc0' }
]);
const b = (x,y,z,w,h,d,role='stone') => ({ min:[x,y,z], max:[x+w,y+h,z+d], role });
const posts = (y,h,role='wood',width=1,depth=1) => [0,width-.15].flatMap(x => [0,depth-.15].map(z=>b(x,y,z,.15,h,.15,role)));
const ring = (y,h,role='stone') => [b(0,y,0,1,h,.2,role),b(0,y,.8,1,h,.2,role),b(0,y,.2,.2,h,.6,role),b(.8,y,.2,.2,h,.6,role)];
const specs = [
  ['pillar','承重柱','architecture','分隔大厅、支撑梁架；柱身遮挡', '墙柱', () => [b(.1,0,.1,.8,.2,.8),b(.25,.2,.25,.5,1.6,.5),b(.1,1.8,.1,.8,.2,.8)]],
  ['arch','通行拱门','architecture','15尺门架，中间至少10尺净宽、10尺净高', '楼梯拱', () => [b(0,0,.25,.5,2.5,.5),b(2.5,0,.25,.5,2.5,.5),b(.5,2,.25,.5,.5,.5),b(2,2,.25,.5,.5,.5),b(.5,2.5,.25,2,.5,.5)]],
  ['wall','薄隔墙','architecture','占用1尺厚度的室内隔断；阻挡视线', '薄墙', () => [b(0,0,.4,1,2,.2),b(0,0,.35,1,.15,.3,'trim'),b(0,1.85,.35,1,.15,.3,'trim')]],
  ['window','透空窗墙','architecture','窗洞可观察和射线穿过，窗台阻挡身体', '玻璃窗框', () => [b(0,0,.35,1,.5,.3),b(0,.5,.35,.2,1.5,.3),b(.8,.5,.35,.2,1.5,.3),b(.2,1.75,.35,.6,.25,.3),b(0,.45,.25,1,.1,.5,'trim')]],
  ['arrow_slit','箭孔墙','architecture','窄竖射孔，城防射击与观察位', '墙体留缝', () => [b(0,0,.3,.4,2,.4),b(.6,0,.3,.4,2,.4),b(.4,0,.3,.2,.8,.4),b(.4,1.6,.3,.2,.4,.4)]],
  ['battlement','垛口护墙','architecture','城墙边缘高低掩护；射界由几何决定', '城垛', () => [b(0,0,.3,1,.5,.4),b(0,.5,.3,.3,.5,.4),b(.7,.5,.3,.3,.5,.4)]],
  ['fence','栅栏','architecture','围栏分区，挡身体、栏间留视线', '栅栏', () => [b(0,0,.4,.15,1,.2,'wood'),b(.85,0,.4,.15,1,.2,'wood'),b(.15,.25,.45,.7,.15,.1,'wood'),b(.15,.65,.45,.7,.15,.1,'wood')]],
  ['bridge','桥面段','terrain','15尺长、5尺宽连续桥面，可跨沟连接', '木板与半砖桥', () => [b(0,0,0,1,.5,3,'wood'),b(0,.05,0,.1,.3,3,'trim'),b(.9,.05,0,.1,.3,3,'trim')]],
  ['beam','横梁','architecture','15尺跨度梁；搭棚或架空支撑', '原木梁', () => [b(0,0,.35,3,.5,.3,'wood'),b(0,0,.3,.2,.5,.4,'trim'),b(2.8,0,.3,.2,.5,.4,'trim')]],
  ['roof','阶梯屋面','architecture','五级屋坡，可沿坡排列构成屋顶', '楼梯屋顶', () => Array.from({length:5},(_,i)=>b(0,i*.2,i*.2,1,.2,1-i*.2,'roof'))],
  ['ridge','屋脊','architecture','连接对称屋面并收口，突出建筑轮廓', '倒置楼梯', () => [b(0,0,0,1,.2,1,'roof'),b(.2,.2,0,.6,.2,1,'roof'),b(.4,.4,0,.2,.2,1,'trim')]],
  ['steps','五级缓阶','terrain','每阶升1尺，15尺长，含5尺顶端平台连接上下层', '楼梯', () => Array.from({length:5},(_,i)=>b(0,0,i*.5,1,(i+1)*.2,i===4?1:.5))],
  ['rubble','坍塌碎石','terrain','废墟低障碍；困难地形由主持人判定', '圆石碎块', () => [b(.05,0,.05,.4,.2,.4),b(.55,0,.25,.4,.4,.55),b(.15,0,.55,.3,.5,.35),b(.4,0,.3,.2,.25,.2)]],
  ['stepping','涉水踏石','terrain','2.5尺高落脚平台，组合跳石/浅滩通路', '半砖', () => [b(.1,0,.1,.8,.4,.8),b(.05,.4,.05,.9,.1,.9,'trim')]],
  ['grate','排水格栅','terrain','可站立透空地板，下方可见，井道盖板', '铁栏杆', () => [b(0,0,0,1,.5,.1,'metal'),b(0,0,.9,1,.5,.1,'metal'),...Array.from({length:5},(_,i)=>b(i*.2,0,.1,.1,.5,.8,'metal'))]],
  ['trapdoor','活板盖','mechanisms','原生门状态开关；关闭支撑，打开露出下层', '活板门', () => [b(0,0,0,1,.5,.15,'wood'),b(0,0,.15,1,.5,.1,'metal'),b(0,0,.25,1,.5,.5,'wood'),b(0,0,.75,1,.5,.1,'metal'),b(0,0,.85,1,.5,.15,'wood')], 'door', 'trapdoor'],
  ['portcullis','升降铁闸','mechanisms','原生开关阻挡通道，开时上提；锁定沿用门状态', '铁栏与门', () => [b(0,1.8,.4,1,.2,.2,'metal'),b(0,.5,.4,1,.1,.2,'metal'),...Array.from({length:5},(_,i)=>b(i*.2,0,.45,.1,1.8,.1,'metal'))], 'door', 'portcullis'],
  ['table','长桌','furniture','宴会、谈判与桌面陈设；桌面可承放物件', '台阶桌', () => [b(0,.4,0,2,.1,1,'wood'),...posts(0,.4,'wood',2,1)]],
  ['chair','靠背椅','furniture','酒馆座席或审讯位，座位有实体碰撞', '楼梯椅', () => [b(.1,.3,.1,.8,.1,.8,'wood'),b(.1,.4,.8,.8,.6,.1,'wood'),...posts(0,.3).map(p=>({ ...p,min:p.min.map((v,i)=>i===1?v:v*.75+.1),max:p.max.map((v,i)=>i===1?v:v*.75+.1)}))]],
  ['bench','长凳','furniture','长排座席，餐桌/教堂/驿站配套', '半砖座椅', () => [b(0,.4,.2,2,.1,.6,'wood'),b(.15,0,.25,.15,.4,.5,'trim'),b(1.7,0,.25,.15,.4,.5,'trim')]],
  ['bed','床铺','furniture','旅店、牢房和营地休息位置；不自动长休', '床', () => [b(.05,.1,0,.9,.25,2,'wood'),b(.05,.35,.05,.9,.15,1.9,'cloth'),b(.15,.5,.1,.7,.1,.35,'paper'),b(.05,0,0,.15,.1,2,'wood'),b(.8,0,0,.15,.1,2,'wood')]],
  ['chest','宝箱','furniture','战利品容器标记；物品清单由主持人管理', '箱子', () => [b(.05,0,.15,.9,.5,.7,'wood'),b(.05,.5,.15,.9,.15,.7,'wood'),b(.1,0,.15,.1,.65,.7,'metal'),b(.8,0,.15,.1,.65,.7,'metal'),b(.45,.3,.1,.1,.2,.05,'metal')]],
  ['barrel','货桶','furniture','补给、酒窖与仓库货物；实心障碍', '木桶', () => [b(.15,0,.15,.7,.8,.7,'wood'),b(.1,.15,.1,.8,.1,.8,'metal'),b(.1,.6,.1,.8,.1,.8,'metal'),b(.2,.8,.2,.6,.05,.6,'wood')]],
  ['bookshelf','书柜','furniture','图书馆线索、书房和空间隔挡', '书架', () => [b(0,0,.5,1,1.5,.1,'wood'),b(0,0,.1,.1,1.5,.4,'wood'),b(.9,0,.1,.1,1.5,.4,'wood'),...[0,.5,1,1.45].map(y=>b(.1,y,.1,.8,.05,.4,'wood')),...[.1,.6,1.1].flatMap(y=>Array.from({length:6},(_,i)=>b(.1+i*.1,y,.15,.1,.3+(i%2)*.05,.3,i%3===0?'cloth':i%3===1?'paper':'rune')))]],
  ['altar','祭坛','furniture','仪式、献祭、封印与任务焦点；无自动法术', '附魔台', () => [b(0,0,0,1,.2,1),b(.15,.2,.15,.7,.6,.7),b(0,.8,0,1,.2,1,'trim'),b(.2,1,.2,.6,.05,.6,'rune')]],
  ['lectern','读经台','furniture','公开书卷、谜题提示和演讲位置', '讲台', () => [b(.15,0,.15,.7,.1,.7,'wood'),b(.4,.1,.4,.2,.6,.2,'wood'),b(.1,.7,.1,.8,.1,.8,'wood'),b(.2,.8,.2,.6,.05,.5,'paper'),b(.45,.85,.2,.1,.05,.5,'trim')]],
  ['hearth','壁炉','furniture','酒馆取暖、烟道入口和火源标记；无自动伤害/照明', '烟熏炉', () => [b(0,0,0,.2,1.5,.8),b(.8,0,0,.2,1.5,.8),b(.2,0,.6,.6,1.5,.2),b(.2,1,0,.6,.5,.6),b(.2,0,0,.6,.1,.6),b(.25,.1,.15,.5,.15,.3,'wood'),b(.35,.25,.2,.3,.35,.2,'ember')]],
  ['brazier','火盆','decor','地牢与营地火源标记；仅自发光材质', '营火/灯笼', () => [b(.3,0,.3,.4,.1,.4,'metal'),b(.45,.1,.45,.1,.5,.1,'metal'),b(.2,.6,.2,.6,.1,.6,'metal'),b(.3,.7,.3,.4,.15,.4,'ember'),b(.4,.85,.4,.2,.15,.2,'ember')], 'decor'],
  ['well','井口','furniture','10尺井口，内孔6尺，水源与地下入口', '炼药锅/水井', () => [...ring(0,.5),...ring(.5,.1,'trim')].map(p=>({...p,min:p.min.map((n,a)=>a===1?n:n*2),max:p.max.map((n,a)=>a===1?n:n*2)})).concat([b(0,.6,.9,.2,1.4,.2,'wood'),b(1.8,.6,.9,.2,1.4,.2,'wood'),b(0,1.9,.9,2,.1,.2,'wood')])],
  ['sarcophagus','石棺','furniture','墓室葬具、遗物与调查位置；不自动开盖', '石砖/箱子', () => [b(.05,0,0,.9,.5,2),b(0,.5,0,1,.2,2,'trim'),b(.4,.7,.3,.2,.05,1.4,'rune'),b(.2,.7,.6,.6,.05,.2,'rune')]],
  ['banner','旗帜','decor','标识阵营、房间或道路；不阻挡走行', '旗帜', () => [b(.45,0,.45,.1,2,.1,'wood'),b(.15,1.85,.45,.7,.1,.1,'wood'),b(.2,.8,.5,.6,1.05,.05,'cloth'),b(.45,.9,.55,.1,.8,.05,'rune')], 'decor'],
  ['plate','机关踏板','decor','机关/陷阱触发区的可见标记；无自动触发或伤害', '压力板', () => [b(.1,0,.1,.8,.1,.8,'metal'),b(.2,.1,.2,.6,.05,.6,'rune')], 'decor']
];
// Exact shared-lattice quantization also removes floating point accumulation.
const snap = n => Math.round(n*20)/20;
export const KIT_TYPES = Object.freeze(specs.map(([key,label,category,use,inspiration,make,kind='solid',motion]) => ({ key,label,category,use,inspiration,make,kind,motion })));
export const KIT_CATALOG = Object.freeze(STYLES.flatMap((style,s) => KIT_TYPES.map((type,i) => {
  const parts = type.make().map(p=>({ ...p, min:p.min.map(snap), max:p.max.map(snap) }));
  const max = [0,1,2].map(a=>Math.max(...parts.map(p=>p.max[a]))), min = [0,1,2].map(a=>Math.min(...parts.map(p=>p.min[a])));
  return { id:17+s*KIT_TYPES.length+i, key:type.key, label:`${type.label}·${style.label}`, shortLabel:type.label, style:style.id, color:style.color, category:type.category,
    shape:type.key, height:max[1], extent:max.map((n,a)=>snap(n-min[a])), kind:type.kind, collision:type.kind!=='decor', sight:type.kind!=='decor', rotate:true, parts, motion:type.motion, use:type.use, inspiration:type.inspiration, icon:'', kit:true };
})));
