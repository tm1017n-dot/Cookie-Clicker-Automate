// Preserve descriptors as well as values: game functions and collection identities matter.
const fields=['value','get','set','writable','enumerable','configurable'];
const same=(a,b)=>a && b && fields.every(field=>Object.is(a[field],b[field]));
export class Journal {
  constructor(objects) {
    this.entries = [...new Set(objects.filter(x => x && typeof x === 'object'))].map(object => ({ object, descriptors: Object.getOwnPropertyDescriptors(object) }));
  }
  restore() {
    for (const { object, descriptors } of [...this.entries].reverse()) {
      for (const key of Reflect.ownKeys(object)) if (!(key in descriptors)) {
        if (!Reflect.deleteProperty(object,key)) throw new Error('restore-delete-failed:' + String(key));
      }
      for(const key of Reflect.ownKeys(descriptors)) {
        if(!same(Object.getOwnPropertyDescriptor(object,key),descriptors[key]))Object.defineProperty(object,key,descriptors[key]);
      }
    }
    for (const { object, descriptors } of this.entries) {
      const actual = Object.getOwnPropertyDescriptors(object);
      if (Reflect.ownKeys(actual).length !== Reflect.ownKeys(descriptors).length) throw new Error('restore-key-mismatch');
      for (const key of Reflect.ownKeys(descriptors)) {
        for (const field of fields)
          if (!Object.is(actual[key]?.[field],descriptors[key][field])) throw new Error('restore-value-mismatch:' + String(key));
      }
    }
  }
}
