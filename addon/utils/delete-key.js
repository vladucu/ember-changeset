import Ember from 'ember';
import isObject from 'ember-changeset/utils/is-changeset';
import pureAssign from 'ember-changeset/utils/assign';

const {
  isEmpty,
} = Ember;

const DOT_SEPARATOR = ".";

const deleteKeysFromObject = function(object, keys, options) {
  let keysToDelete;

  options = options || {};
  let imutable = options.hasOwnProperty('imutable') ? options.imutable : true;
  let finalObject;
  if (imutable) {
    finalObject = pureAssign({}, object);
  } else {
    finalObject = object;
  }

  if (typeof finalObject === 'undefined') {
    throw new Error('undefined is not a valid object.');
  }
  if (arguments.length < 2) {
    throw new Error("provide at least two parameters: object and list of keys");
  }

  // collect keys
  if (Array.isArray(keys)) {
    keysToDelete = keys;
  } else {
    keysToDelete = [keys];
  }

  keysToDelete.forEach(function(elem) {
    for(let prop in finalObject) {
      if(finalObject.hasOwnProperty(prop)) {
        if (elem === prop) {
          // simple key to delete
          delete finalObject[prop];
        } else if (elem.indexOf(DOT_SEPARATOR) != -1) {
          let parts = elem.split(DOT_SEPARATOR);
          let pathWithoutLastEl;

          let lastAttribute;

          if (parts && parts.length === 2) {

            lastAttribute = parts[1];
            pathWithoutLastEl = parts[0];
            let nestedObjectRef = finalObject[pathWithoutLastEl];
            if (!isEmpty(nestedObjectRef)) {
              delete nestedObjectRef[lastAttribute];

              // Also remove this from the parent object, if empty
              if (Object.keys(nestedObjectRef).length === 0) {
                delete finalObject[pathWithoutLastEl];
              }
            }
          } else if (parts && parts.length === 3) {
            // last attribute is the last part of the parts
            lastAttribute = parts[2];
            let nestedObjectRef = finalObject[parts[0]];
            if (!isEmpty(nestedObjectRef)) {
              let deepestRef = nestedObjectRef[parts[1]];
              delete deepestRef[lastAttribute];
            }
          } else {
            throw new Error("Nested level " + parts.length + " is not supported yet");
          }
        } else {
          if (isObject(finalObject[prop])) {
            finalObject[prop] = deleteKeysFromObject(finalObject[prop], keysToDelete, options);
            if (Object.keys(finalObject[prop]).length === 0) {
              delete finalObject[prop];
            }
          }
        }
      }
    }
  });

  return isEmpty(finalObject) ? {} : finalObject;
};

export default deleteKeysFromObject;
