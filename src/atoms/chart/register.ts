/**
 * Chart.js 全局注册模块
 * 在应用启动时调用一次，确保所有图表组件已注册
 */

import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
  BarElement,
  ArcElement,
  RadialLinearScale,
} from 'chart.js';

let registered = false;

export function registerChartJSComponents(): void {
  if (registered || typeof window === 'undefined') {
    return;
  }

  ChartJS.register(
    CategoryScale,
    LinearScale,
    PointElement,
    LineElement,
    BarElement,
    ArcElement,
    RadialLinearScale,
    Title,
    Tooltip,
    Legend
  );

  registered = true;
}

export { ChartJS };