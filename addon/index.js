import Ember from 'ember';
import Relay from 'ember-changeset/-private/relay';
import objectToArray from 'ember-changeset/utils/computed/object-to-array';
import isEmptyObject from 'ember-changeset/utils/computed/is-empty-object';
import isPromise from 'ember-changeset/utils/is-promise';
import isObject from 'ember-changeset/utils/is-object';
import pureAssign from 'ember-changeset/utils/assign';
import objectWithout from 'ember-changeset/utils/object-without';
import includes from 'ember-changeset/utils/includes';
import take from 'ember-changeset/utils/take';
import isChangeset, { CHANGESET } from 'ember-changeset/utils/is-changeset';
import deleteKey from 'ember-changeset/utils/delete-key';
import deepSet from 'ember-changeset/utils/deep-set';

const {
  Object: EmberObject,
  RSVP: { all, resolve },
  computed: { not, readOnly },
  Evented,
  A: emberArray,
  assert,
  get,
  isArray,
  isEmpty,
  isEqual,
  isNone,
  isPresent,
  set,
  setProperties,
  typeOf
} = Ember;
const { keys } = Object;
const CONTENT = '_content';
const CHANGES = '_changes';
const ERRORS = '_errors';
const VALIDATOR = '_validator';
const RELAY_CACHE = '_relayCache';
const OPTIONS = '_options';
const RUNNING_VALIDATIONS = '_runningValidations';
const BEFORE_VALIDATION_EVENT = 'beforeValidation';
const AFTER_VALIDATION_EVENT = 'afterValidation';

function defaultValidatorFn() {
  return true;
}

const defaultOptions = { skipValidate: false };

/**
 * Creates new changesets.
 *
 * @uses Ember.Evented
 * @param  {Object} obj
 * @param  {Function} validateFn
 * @param  {Object} validationMap
 * @param  {Object}  options
 * @return {Ember.Object}
 */
export function changeset(obj, validateFn = defaultValidatorFn, validationMap = {}, options = {}) {
  assert('Underlying object for changeset is missing', isPresent(obj));

  return EmberObject.extend(Evented, {
    /**
     * Internal descriptor for changeset identification
     *
     * @private
     * @property __changeset__
     * @type {String}
     */
    __changeset__: CHANGESET,

    changes: objectToArray(CHANGES, false),
    errors: objectToArray(ERRORS, true),
    change: readOnly(CHANGES),
    error: readOnly(ERRORS),

    isValid: isEmptyObject(ERRORS),
    isPristine: isEmptyObject(CHANGES),
    isInvalid: not('isValid').readOnly(),
    isDirty: not('isPristine').readOnly(),

    init() {
      this._super(...arguments);
      this[CONTENT] = obj;
      this[CHANGES] = {};
      this[ERRORS] = {};
      this[RELAY_CACHE] = {};
      this[VALIDATOR] = validateFn;
      this[OPTIONS] = pureAssign(defaultOptions, options);
      this[RUNNING_VALIDATIONS] = {};
    },

    /**
     * Proxies `get` to the underlying content or changed value, if present.
     *
     * @public
     * @param  {String} key
     * @return {Any}
     */
    unknownProperty(key) {
      return this.valueFor(key);
    },

    /**
     * Stores change on the changeset.
     *
     * @public
     * @param  {String} key
     * @param  {Any} value
     * @return {Any}
     */
    setUnknownProperty(key, value) {
      return this.validateAndSet(key, value);
    },

    /**
     * String representation for the changeset.
     *
     * @public
     * @return {String}
     */
    toString() {
      let normalisedContent = pureAssign(get(this, CONTENT), {});
      return `changeset:${normalisedContent.toString()}`;
    },

    /**
     * Teardown relays from cache.
     *
     * @public
     * @return {Void}
     */
    willDestroy() {
      // TODO destroy all relays
      this._super(...arguments);
    },

    /**
     * Provides a function to run before emitting changes to the model. The
     * callback function must return a hash in the same shape:
     *
     * ```
     * changeset
     *   .prepare((changes) => {
     *     let modified = {};
     *
     *     for (let key in changes) {
     *       modified[underscore(key)] = changes[key];
     *     }
     *
     *    return modified; // { first_name: "Jim", last_name: "Bob" }
     *  })
     *  .execute(); // execute the changes
     * ```
     *
     * @public
     * @chainable
     * @param  {Function} prepareChangesFn
     * @return {Changeset}
     */
    prepare(prepareChangesFn) {
      let changes = pureAssign(get(this, CHANGES));
      let preparedChanges = prepareChangesFn(changes);

      assert('Callback to `changeset.prepare` must return an object', isObject(preparedChanges));

      set(this, CHANGES, preparedChanges);

      return this;
    },

    /**
     * Executes the changeset if in a valid state.
     *
     * @public
     * @chainable
     * @return {Changeset}
     */
    execute() {
      if (get(this, 'isValid') && get(this, 'isDirty')) {
        let content = get(this, CONTENT);
        let changes = get(this, CHANGES);
        setProperties(content, changes);
      }

      return this;
    },

    /**
     * Executes the changeset and saves the underlying content.
     *
     * @async
     * @public
     * @param  {Object} options optional object to pass to content save method
     * @return {Promise}
     */
    save(options) {
      let content = get(this, CONTENT);
      let savePromise = resolve(this);

      this.execute();

      if (typeOf(content.save) === 'function') {
        savePromise = content.save(options);
      }

      return savePromise.then((result) => {
        this.rollback();
        return result;
      });
    },

    /**
     * Returns the changeset to its pristine state, and discards changes and
     * errors.
     *
     * @public
     * @chainable
     * @return {Changeset}
     */
    rollback() {
      this._notifyVirtualProperties();
      set(this, CHANGES, {});
      set(this, ERRORS, {});

      return this;
    },

    /**
     * Merges 2 valid changesets and returns a new changeset. Both changesets
     * must point to the same underlying object. The changeset target is the
     * origin. For example:
     *
     * ```
     * let changesetA = new Changeset(user, validatorFn);
     * let changesetB = new Changeset(user, validatorFn);
     * changesetA.set('firstName', 'Jim');
     * changesetB.set('firstName', 'Jimmy');
     * changesetB.set('lastName', 'Fallon');
     * let changesetC = changesetA.merge(changesetB);
     * changesetC.execute();
     * user.get('firstName'); // "Jimmy"
     * user.get('lastName'); // "Fallon"
     * ```
     *
     * @public
     * @chainable
     * @param  {Changeset} changeset
     * @return {Changeset}
     */
    merge(changeset) {
      let content = get(this, CONTENT);
      assert('Cannot merge with a non-changeset', isChangeset(changeset));
      assert('Cannot merge with a changeset of different content', get(changeset, CONTENT) === content);

      if (get(this, 'isPristine') && get(changeset, 'isPristine')) {
        return this;
      }

      let changesA = get(this, CHANGES);
      let changesB = get(changeset, CHANGES);
      let errorsA = get(this, ERRORS);
      let errorsB = get(changeset, ERRORS);
      let newChangeset = new Changeset(content, get(this, VALIDATOR));
      let newErrors = objectWithout(keys(changesB), errorsA);
      let newChanges = objectWithout(keys(errorsB), changesA);
      let mergedChanges = pureAssign(newChanges, changesB);
      let mergedErrors = pureAssign(newErrors, errorsB);

      newChangeset[CHANGES] = mergedChanges;
      newChangeset[ERRORS] = mergedErrors;
      newChangeset._notifyVirtualProperties();

      return newChangeset;
    },

    /**
     * Validates the changeset immediately against the validationMap passed in.
     * If no key is passed into this method, it will validate all fields on the
     * validationMap and set errors accordingly. Will throw an error if no
     * validationMap is present.
     *
     * @async
     * @public
     * @param  {String|Undefined} key
     * @return {Promise}
     */
    validate(key) {
      if (keys(validationMap).length === 0) {
        return resolve(null);
      }

      if (isNone(key)) {
        let maybePromise = keys(validationMap)
          .map((validationKey) => {
            return this.validateAndSet(validationKey, this.valueFor(validationKey));
          });

        return all(maybePromise);
      }

      return resolve(this.validateAndSet(key, this.valueFor(key)));
    },


    /**
     * Checks to see if async validator for a given key has not resolved.
     * If no key is provided it will check to see if any async validator is running.
     *
     * @public
     * @param  {String|Undefined} key
     * @return {boolean}
     */
    isValidating(key) {
      let runningValidations = get(this, RUNNING_VALIDATIONS);
      let ks = emberArray(keys(runningValidations));
      if (key) { return ks.includes(key); }

      return !isEmpty(ks);
    },

    /**
     * Manually add an error to the changeset. If there is an existing error or
     * change for `key`, it will be overwritten.
     *
     * @public
     * @param {String} key
     * @param {Any} options.value
     * @param {Any} options.validation Validation message
     * @return {Any}
     */
    addError(key, options) {
      let errors = get(this, ERRORS);

      if (!isObject(options)) {
        let value = get(this, key);
        options = { value, validation: options };
      }

      this._deleteKey(CHANGES, key);
      this.notifyPropertyChange(ERRORS);
      this.notifyPropertyChange(key);

      return deepSet(errors, key, options);
    },

    /**
     * Manually push multiple errors to the changeset as an array. If there is
     * an existing error or change for `key`. it will be overwritten.
     *
     * @param  {String} key
     * @param  {...[String]} newErrors
     * @return {Any}
     */
    pushErrors(key, ...newErrors) {
      let errors = get(this, ERRORS);
      let existingError = get(errors, key) || { validation: [], value: null };
      let { validation, value } = existingError;
      value = value || get(this, key);

      if (!isArray(validation) && isPresent(validation)) {
        existingError.validation = [existingError.validation];
      }

      validation = [...existingError.validation, ...newErrors];

      this._deleteKey(CHANGES, key);
      this.notifyPropertyChange(ERRORS);
      this.notifyPropertyChange(key);

      return set(errors, key, { value, validation });
    },

    /**
     * Creates a snapshot of the changeset's errors and changes.
     *
     * @public
     * @return {Object} snapshot
     */
    snapshot() {
      return {
        changes: pureAssign(get(this, CHANGES)),
        errors: pureAssign(get(this, ERRORS))
      };
    },

    /**
     * Restores a snapshot of changes and errors. This overrides existing
     * changes and errors.
     *
     * @public
     * @chainable
     * @param  {Object} options.changes
     * @param  {Object} options.errors
     * @return {Changeset}
     */
    restore({ changes, errors }) {
      set(this, CHANGES, changes);
      set(this, ERRORS, errors);
      this._notifyVirtualProperties();

      return this;
    },

    /**
     * Unlike `Ecto.Changeset.cast`, `cast` will take allowed keys and
     * remove unwanted keys off of the changeset. For example, this method
     * can be used to only allow specified changes through prior to saving.
     *
     * @public
     * @chainable
     * @param  {Array} allowed Array of allowed keys
     * @return {Changeset}
     */
    cast(allowed = []) {
      let changes = get(this, CHANGES);

      if (isArray(allowed) && allowed.length === 0) {
        return changes;
      }

      let changeKeys = keys(changes);
      let validKeys = emberArray(changeKeys).filter((key) => includes(allowed, key));
      let casted = take(changes, validKeys);

      set(this, CHANGES, casted);

      return this;
    },

    /**
     * For a given key and value, set error or change.
     *
     * @public
     * @param  {String} key
     * @param  {Any} value
     * @return {Any}
     */
    validateAndSet(key, value) {
      let content = get(this, CONTENT);
      let oldValue = get(content, key);
      let options = get(this, OPTIONS);
      let skipValidate = get(options, 'skipValidate');
      if (skipValidate) {
        return this._setProperty(true, { key, value });
      }

      let validation = this._validate(key, value, oldValue);

      if (isPromise(validation)) {
        this._setIsValidating(key, true);
        this.trigger(BEFORE_VALIDATION_EVENT, key);
        return validation.then((resolvedValidation) => {
          this._setIsValidating(key, false);
          this.trigger(AFTER_VALIDATION_EVENT, key);
          return this._setProperty(resolvedValidation, { key, value, oldValue });
        });
      }

      this.trigger(BEFORE_VALIDATION_EVENT, key);
      this.trigger(AFTER_VALIDATION_EVENT, key);
      return this._setProperty(validation, { key, value, oldValue });
    },

    /**
     * Value for change or the original value.
     *
     * @public
     * @param  {String} key
     * @return {Any}
     */
    valueFor(key) {
      let changes = get(this, CHANGES);
      let errors = get(this, ERRORS);
      let content = get(this, CONTENT);
      let cache = get(this, RELAY_CACHE);

      let error = this._recursivelyGet(key, errors);
      if (!isNone(error)) {
        return get(error, 'value');
      }

      if (cache.hasOwnProperty(key)) {
        return this._relayFor(key);
      }

      let change = this._recursivelyGet(key, changes);
      if (!isNone(change)) {
        return change;
      }

      if (changes.hasOwnProperty(key)) {
        return get(changes, key) ;
      }

      let oldValue = get(content, key);

      if (isObject(oldValue)) {
        return this._relayFor(key);
      }

      return oldValue;
    },

    /**
     * Validates a given key and value.
     *
     * @private
     * @param {String} key
     * @param {Any} newValue
     * @param {Any} oldValue
     * @return {Boolean|String}
     */
    _validate(key, newValue, oldValue) {
      let changes = get(this, CHANGES);
      let validator = get(this, VALIDATOR);
      let content = get(this, CONTENT);

      if (typeOf(validator) === 'function') {
        let isValid = validator({
          key,
          newValue,
          oldValue,
          changes: pureAssign(changes),
          content,
        });

        return isPresent(isValid) ? isValid : true;
      }

      return true;
    },

    /**
     * Sets property or error on the changeset.
     *
     * @private
     * @param {Boolean|Array|String} validation
     * @param {String} options.key
     * @param {Any} options.value
     * @return {Any}
     */
    _setProperty(validation, { key, value, oldValue } = {}) {
      let changes = get(this, CHANGES);
      let isSingleValidationArray =
        isArray(validation) &&
        validation.length === 1 &&
        validation[0] === true;
      let [root] = key.split('.');

      if (validation === true || isSingleValidationArray) {
        this._deleteKey(ERRORS, key);

        if (!isEqual(oldValue, value)) {
          deepSet(changes, key, value);
        } else if (changes.hasOwnProperty(key)) {
          this._deleteKey(CHANGES, key);
        }

        this.notifyPropertyChange(CHANGES);
        this.notifyPropertyChange(root);

        let errors = get(this, ERRORS);
        if (errors['__ember_meta__'] && errors['__ember_meta__']['values']) {
          delete errors['__ember_meta__']['values'][key];
          set(this, ERRORS, errors);
        }

        return value;
      }

      return this.addError(key, { value, validation });
    },

    /**
     * Updates the cache that stores the number of running validations
     * for a given key.
     *
     * @private
     * @param {String} key
     * @param {Boolean} value
     */
    _setIsValidating(key, value) {
      let runningValidations = get(this, RUNNING_VALIDATIONS);
      let count = get(runningValidations, key) || 0;

      if (value) {
        set(runningValidations, key, count + 1);
      } else {
        if (count === 1) {
          delete runningValidations[key];
        } else {
          set(runningValidations, key, count - 1);
        }
      }
    },

    _recursivelyGet(key, obj) {
      let keys = key.split('.');
      let next = keys.shift();

      while (keys.length >= 1) {
        obj = get(obj, next);
        if (isNone(obj)) {
          return undefined;
        }
        next = keys.shift();
      }
      return get(obj, next);
    },

    /**
     * TODO
     *
     * @private
     * @param {String} key
     * @param {Any} value
     * @param {Boolean} [shouldInvalidate=false]
     * @return {Any}
     */
    _relayFor(key, shouldInvalidate = false) {
      let cache = get(this, RELAY_CACHE);
      let found = cache[key];

      if (shouldInvalidate) {
        found && found.destroy();
        delete cache[key];
      }

      if (!isNone(found)) {
        return found;
      }

      let relay = Relay.create({ key, changeset: this });
      cache[key] = relay;
      return relay;
    },

    /**
     * Notifies all virtual properties set on the changeset of a change.
     *
     * @private
     * @return {Void}
     */
    _notifyVirtualProperties() {
      let rollbackKeys = [...keys(get(this, CHANGES)), ...keys(get(this, ERRORS))];

      for (let i = 0; i < rollbackKeys.length; i++) {
        this.notifyPropertyChange(rollbackKeys[i]);
      }
    },

    /**
     * Deletes a key off an object and notifies observers.
     *
     * @private
     * @param  {String} objName
     * @param  {String} key
     * @return {Void}
     */
    _deleteKey(objName, key) {
      let obj = get(this, objName);

      if (isNone(obj)) {
        return;
      }

      let objWithoutKey = deleteKey(obj, key);
      if (!isEqual(obj, objWithoutKey)) {
        set(this, objName, objWithoutKey);
        this.notifyPropertyChange(`${objName}.${key}`);
        this.notifyPropertyChange(objName);
      }
    }
  });
}

export default class Changeset {
  /**
   * Changeset factory
   *
   * @class Changeset
   * @constructor
   */
  constructor() {
    return changeset(...arguments).create();
  }
}
