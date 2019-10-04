import pDefer from 'p-defer'
import { noop, secs } from './util'

export interface PoolConfig {
  gcIntervalTime: number
  maxResorces: number
  maxIddleTime: number
  maxLifeTime: number
  create: Function
  destroy: Function
  beforeAcquire: Function
  beforeAvailable: Function
}

class ResourceWrapper<T> {
  resource: T
  createdAt: number = 0
  acquiredAt: number = 0
  availableAt: number = 0
  constructor(resource: T) {
    this.resource = resource
    this.createdAt = Date.now()
  }
}

export default class Pool<T> {
  config: PoolConfig
  available: ResourceWrapper<T>[]
  acquired: ResourceWrapper<T>[]
  // java days
  deferredPromisesWaitingForAvailableResource: pDefer.DeferredPromise<T>[]
  isDestroyed: boolean
  isLending: boolean

  gcIntervalId: NodeJS.Timeout

  constructor(config: Partial<PoolConfig>) {
    const defaults = {
      gcIntervalTime: secs(10),
      maxResorces: 5,
      maxIddleTime: secs(10),
      maxLifeTime: secs(30),
      create: noop,
      destory: noop,
      beforeAcquire: noop,
      beforeAvailable: noop,
    }
    this.config = { ...defaults, ...config } as PoolConfig
    this.available = []
    this.acquired = []
    // java days
    this.deferredPromisesWaitingForAvailableResource = []
    this.isDestroyed = false
    this.isLending = false

    this.gcIntervalId = setInterval(this.runGc, this.config.gcIntervalTime)
  }

  private runGc = () => {
    if (this.available.length === 0) return

    const now = Date.now()

    // collect iddles and stales when available
    const garbage: T[] = []
    this.available.forEach(rw => {
      const availableAt = rw.availableAt as number
      const createdAt = rw.createdAt as number

      if ((now - availableAt >= this.config.maxIddleTime)) {
        garbage.push(rw.resource)
      }

      if (now - createdAt >= this.config.maxLifeTime) {
        garbage.push(rw.resource)
      }
    })

    // remove garbage
    garbage.forEach(r => this.remove(r))
  }

  private findWrapperIdxByResource(list: ResourceWrapper<T>[], resource: T) {
    return list.findIndex(rw => rw.resource === resource)
  }

  isAvailable(resource: T) {
    return ~this.findWrapperIdxByResource(this.available, resource)
  }

  isAcquired(resource: T) {
    return ~this.findWrapperIdxByResource(this.acquired, resource)
  }

  contains(resource: T) {
    return this.isAvailable(resource) || this.isAcquired(resource)
  }

  length() {
    return this.available.length + this.acquired.length
  }

  isFull() {
    return this.length() >= this.config.maxResorces
  }

  hasAvailableResources() {
    return this.available.length > 0
  }

  async lendResources() {
    // mutex on
    if (this.isLending) return
    this.isLending = true

    const { create, beforeAcquire, beforeAvailable } = this.config
    while (this.deferredPromisesWaitingForAvailableResource.length) {
      if (this.isDestroyed) return

      // just collaborate
      await Promise.resolve()

      if (!this.isFull() && !this.hasAvailableResources()) {
        const resource = await Promise.resolve(create())
        const resourceWrapper = new ResourceWrapper(resource)
        const canBeAvailable = await beforeAvailable(resource)
        if (canBeAvailable !== false) {
          resourceWrapper.availableAt = Date.now()
          this.available.push(resourceWrapper)
        }
      }

      if (this.hasAvailableResources() && this.deferredPromisesWaitingForAvailableResource.length) {
        const resourceWrapper = this.available[0]
        const canBeAcquired = await beforeAcquire(resourceWrapper.resource)
        if (canBeAcquired !== false) {
          this.available.shift()
          resourceWrapper.acquiredAt = Date.now()
          this.acquired.push(resourceWrapper)
          const deferredPromise = this.deferredPromisesWaitingForAvailableResource.shift()
          if (deferredPromise) deferredPromise.resolve(resourceWrapper.resource)
        }
      } else {
        break
      }
    }

    // mutex off
    this.isLending = false
  }

  async acquire() {
    if (this.isDestroyed) return
    const deferredPromise: pDefer.DeferredPromise<T> = pDefer()
    this.deferredPromisesWaitingForAvailableResource.push(deferredPromise)
    await this.lendResources()
    return deferredPromise.promise
  }

  async release(resource: T) {
    if (this.isDestroyed) return
    const { beforeAvailable } = this.config
    if (this.isAcquired(resource)) {
      const canBeAvailable = await beforeAvailable(resource)
      if (canBeAvailable !== false) {
        const idx = this.findWrapperIdxByResource(this.acquired, resource)
        const resourceWrapper = this.acquired[idx]
        this.acquired.splice(idx, 1)
        resourceWrapper.availableAt = Date.now()
        this.available.push(resourceWrapper)
      }
    }
    this.lendResources()
  }

  async remove(resource: T) {
    const { destroy } = this.config
    if (this.isAvailable(resource)) {
      const idx = this.findWrapperIdxByResource(this.available, resource)
      this.available.splice(idx, 1)
    } else if (this.isAcquired(resource)) {
      const idx = this.findWrapperIdxByResource(this.acquired, resource)
      this.acquired.splice(idx, 1)
    }
    await destroy(resource)
    this.lendResources()
  }

  async destroy() {
    this.isDestroyed = true
    clearInterval(this.gcIntervalId)
    const resources = [...this.available, ...this.acquired]
    this.available.splice(0, this.available.length)
    this.acquired.splice(0, this.acquired.length)
    this.deferredPromisesWaitingForAvailableResource.forEach(p => p.resolve())
    const promises = resources.map(rw => this.remove(rw.resource))
    return Promise.all(promises)
  }

}



// import pDefer from 'p-defer'
// import { noop } from './util'

// export interface PoolConfig {
//   max: Number
//   create: Function
//   destroy: Function
//   beforeAcquire: Function
//   beforeAvailable: Function
// }

// class ResourceWrapper<T, M> {
//   metadata: M = Object.create(null)
//   resource: T
//   constructor(resource: T) {
//     this.resource = resource
//   }
// }

// export default class Pool<T> {
//   config: PoolConfig
//   availableResources: T[]
//   acquiredResources: T[]
//   // java days
//   deferredPromisesWaitingForAvailableResource: pDefer.DeferredPromise<T>[]
//   isDestroyed: boolean
//   isLending: boolean

//   constructor(config: Partial<PoolConfig>) {
//     const defaults = {
//       max: 5,
//       create: noop,
//       destory: noop,
//       beforeAcquire: noop,
//       beforeAvailable: noop,
//     }
//     this.config = { ...defaults, ...config } as PoolConfig
//     this.availableResources = []
//     this.acquiredResources = []
//     // java days
//     this.deferredPromisesWaitingForAvailableResource = []
//     this.isDestroyed = false
//     this.isLending = false
//   }

//   isAvailable(resource: T) {
//     return ~this.availableResources.indexOf(resource)
//   }

//   isAcquired(resource: T) {
//     return ~this.acquiredResources.indexOf(resource)
//   }

//   contains(resource: T) {
//     return this.isAvailable(resource) || this.isAcquired(resource)
//   }

//   length() {
//     return this.availableResources.length + this.acquiredResources.length
//   }

//   isFull() {
//     return this.length() >= this.config.max
//   }

//   hasAvailableResources() {
//     return this.availableResources.length > 0
//   }

//   async lendResources() {
//     // mutex on
//     if (this.isLending) return
//     this.isLending = true

//     const { create, beforeAcquire, beforeAvailable } = this.config
//     while (this.deferredPromisesWaitingForAvailableResource.length) {
//       if (this.isDestroyed) return

//       // just collaborate
//       await Promise.resolve()

//       if (!this.isFull() && !this.hasAvailableResources()) {
//         const resource = await Promise.resolve(create())
//         const canBeAvailable = await beforeAvailable(resource)
//         if (canBeAvailable !== false) this.availableResources.push(resource)
//       }

//       if (this.hasAvailableResources() && this.deferredPromisesWaitingForAvailableResource.length) {
//         const resource = this.availableResources[0]
//         const canBeAcquired = await beforeAcquire(resource)
//         if (canBeAcquired !== false) {
//           this.availableResources.shift()
//           this.acquiredResources.push(resource)
//           const deferredPromise = this.deferredPromisesWaitingForAvailableResource.shift()
//           if (deferredPromise) deferredPromise.resolve(resource)
//         }
//       } else {
//         break
//       }
//     }

//     // mutex off
//     this.isLending = false
//   }

//   async acquire() {
//     if (this.isDestroyed) return
//     const deferredPromise: pDefer.DeferredPromise<T> = pDefer()
//     this.deferredPromisesWaitingForAvailableResource.push(deferredPromise)
//     await this.lendResources()
//     return deferredPromise.promise
//   }

//   async release(resource: T) {
//     if (this.isDestroyed) return
//     const { beforeAvailable } = this.config
//     if (this.isAcquired(resource)) {
//       const canBeAvailable = await beforeAvailable(resource)
//       if (canBeAvailable !== false) {
//         this.acquiredResources.splice(this.acquiredResources.indexOf(resource), 1)
//         this.availableResources.push(resource)
//       }
//     }
//     this.lendResources()
//   }

//   async remove(resource: T) {
//     const { destroy } = this.config
//     if (this.isAvailable(resource)) {
//       this.availableResources.splice(this.availableResources.indexOf(resource), 1)
//     } else if (this.isAcquired(resource)) {
//       this.acquiredResources.splice(this.acquiredResources.indexOf(resource), 1)
//     }
//     await destroy(resource)
//     this.lendResources()
//   }

//   async destroy() {
//     this.isDestroyed = true
//     const resources = [...this.availableResources, ...this.acquiredResources]
//     this.availableResources.splice(0, this.availableResources.length)
//     this.acquiredResources.splice(0, this.acquiredResources.length)
//     this.deferredPromisesWaitingForAvailableResource.forEach(p => p.resolve())
//     const promises = resources.map(r => this.remove(r))
//     return Promise.all(promises)
//   }

// }
