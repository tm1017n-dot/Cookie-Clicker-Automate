// Preserve descriptors as well as values: game functions and collection identities matter.
export class Journal {
  constructor(objects) {
    this.entries = [...new Set(objects.filter(x => x && typeof x === 'object'))].map(object => ({ object, descriptors: Object.getOwnPropertyDescriptors(object) }));
  }
  restore() {
    for (const { object, descriptors } of [...this.entries].reverse()) {
      for (const key of Reflect.ownKeys(object)) if (!(key in descriptors)) {
        if (!Reflect.deleteProperty(object,key)) throw new Error('restore-delete-failed:' + String(key));
      }
      Object.defineProperties(object,descriptors);
    }
    for (const { object, descriptors } of this.entries) {
      const actual = Object.getOwnPropertyDescriptors(object);
      if (Reflect.ownKeys(actual).length !== Reflect.ownKeys(descriptors).length) throw new Error('restore-key-mismatch');
      for (const key of Reflect.ownKeys(descriptors)) {
        for (const field of ['value','get','set','writable','enumerable','configurable'])
          if (!Object.is(actual[key]?.[field],descriptors[key][field])) throw new Error('restore-value-mismatch:' + String(key));
      }
    }
  }
}
