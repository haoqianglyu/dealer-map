// 短 TTL + 在途共享：同一份数据的并发请求只发一次，TTL 内直接用结果；失败不缓存。
// scope：换会话（重新登录）时缓存作废，旧响应也不写回。
export function createSharedFetch(fn, { ttl = 30000, now = () => Date.now(), scope = () => '' } = {}) {
  let value
  let at = 0
  let has = false
  let inflight = null
  let owner = scope()
  const sync = () => {
    const s = scope()
    if (s !== owner) {
      owner = s
      has = false
      inflight = null
    }
  }
  return {
    // maxAge：可接受的结果年龄；0 = 不用缓存，但并发时共用在途请求
    get({ maxAge = ttl } = {}) {
      sync()
      if (has && now() - at < maxAge) return Promise.resolve(value)
      if (inflight) return inflight
      const s = owner
      const p = Promise.resolve()
        .then(fn)
        .then((v) => {
          if (s === scope()) {
            value = v
            at = now()
            has = true
          }
          return v
        })
        .finally(() => {
          if (inflight === p) inflight = null
        })
      inflight = p
      return p
    },
  }
}

// 按 id 去重 + 限并发的批量加载（经销商名称）：写入一个结果引发列表重算时不会再次请求同一批 id。
// 失败的 id 在 retryAfter 后才允许重试
export function createIdLoader(fn, { concurrency = 3, retryAfter = 10 * 60 * 1000, now = () => Date.now(), onValue } = {}) {
  const state = new Map() // id → { status: 'queued' | 'done' | 'fail', at }
  const queue = []
  let running = 0
  const pump = () => {
    while (running < concurrency && queue.length) {
      const id = queue.shift()
      running++
      Promise.resolve()
        .then(() => fn(id))
        .then(
          (v) => {
            state.set(id, { status: 'done', at: now() })
            onValue?.(id, v)
          },
          () => state.set(id, { status: 'fail', at: now() })
        )
        .finally(() => {
          running--
          pump()
        })
    }
  }
  return {
    want(ids) {
      for (const id of ids) {
        const s = state.get(id)
        if (s && s.status !== 'fail') continue
        if (s && now() - s.at < retryAfter) continue
        state.set(id, { status: 'queued', at: now() })
        queue.push(id)
      }
      pump()
    },
    mark(id) {
      state.set(id, { status: 'done', at: now() })
    },
  }
}
