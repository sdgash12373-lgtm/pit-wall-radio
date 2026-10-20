// gripDelta：秒；wearRate：每圈百分比；wetnessRange：合適的賽道濕度。
export const COMPOUNDS = {
  soft: { name: '軟胎', color: '#f56565', gripDelta: -0.45, wearRate: 3.3, cliff: 72, wetnessRange: [0, 0.2] },
  medium: { name: '中性胎', color: '#f4d35e', gripDelta: 0, wearRate: 2.55, cliff: 76, wetnessRange: [0, 0.2] },
  hard: { name: '硬胎', color: '#eeeeee', gripDelta: 0.35, wearRate: 1.75, cliff: 82, wetnessRange: [0, 0.2] },
  inter: { name: '半雨胎', color: '#55bf77', gripDelta: 0.5, wearRate: 2.25, cliff: 78, wetnessRange: [0.2, 0.65] },
  wet: { name: '全雨胎', color: '#55aaff', gripDelta: 1.15, wearRate: 1.95, cliff: 80, wetnessRange: [0.65, 1] },
};
