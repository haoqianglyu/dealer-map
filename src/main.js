import { createApp } from 'vue'
import '@kjgl77/datav-vue3/dist/style.css'
import App from './App.vue'
import router from './router'
import './assets/global.scss'

createApp(App).use(router).mount('#app')
