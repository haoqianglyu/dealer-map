// ECharts 按需注册：全站只用这几种图表和组件；要用新图表时在这里加，别再 import 'echarts' 全量包
import { use, init, registerMap, getMap, graphic } from 'echarts/core'
import { BarChart, LineChart, MapChart, ScatterChart } from 'echarts/charts'
import { GridComponent, TooltipComponent, MarkLineComponent, GeoComponent, VisualMapComponent } from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'

use([BarChart, LineChart, MapChart, ScatterChart, GridComponent, TooltipComponent, MarkLineComponent, GeoComponent, VisualMapComponent, CanvasRenderer])

export { init, registerMap, getMap, graphic }
