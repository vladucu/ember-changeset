import Ember from 'ember';
import Changeset from 'ember-changeset';
import { module, test } from 'qunit';

const {
  Object: EmberObject,
  RSVP: { resolve, Promise },
  String: { dasherize },
  run,
  get,
  isPresent,
  set,
  typeOf
} = Ember;

const {
  next
} = run;

let dummyModel;
let dummyValidations = {
  name(value) {
    return isPresent(value) && value.length > 3 || 'too short';
  },
  password(value) {
    return value || ['foo', 'bar'];
  },
  passwordConfirmation(newValue, _oldValue, { password: changedPassword }, { password }) {
    return isPresent(newValue) && (changedPassword === newValue || password === newValue) || "password doesn't match";
  },
  async(value) {
    return resolve(value);
  },
  options(value) {
    return isPresent(value);
  },
  'org.usa.ny'(value) {
    debugger // this should hit (but it's not)
  }
};

function dummyValidator({ key, newValue, oldValue, changes, content }) {
  let validatorFn = get(dummyValidations, key);

  if (typeOf(validatorFn) === 'function') {
    return validatorFn(newValue, oldValue, changes, content);
  }
}

module('Unit | Utility | changeset', {
  beforeEach() {
    let Dummy = EmberObject.extend({
      save() {
        return resolve(this);
      }
    });
    dummyModel = Dummy.create();
  }
});

// Methods
test('#get proxies to content', function(assert) {
  set(dummyModel, 'name', 'Jim Bob');
  let dummyChangeset = new Changeset(dummyModel);
  let result = get(dummyChangeset, 'name');

  assert.equal(result, 'Jim Bob', 'should proxy to content');
});

test('#get returns change if present', function(assert) {
  set(dummyModel, 'name', 'Jim Bob');
  let dummyChangeset = new Changeset(dummyModel);
  set(dummyChangeset, 'name', 'Milton Waddams');
  let result = get(dummyChangeset, 'name');

  assert.equal(result, 'Milton Waddams', 'should proxy to change');
});

test('#get returns change that is a blank value', function(assert) {
  set(dummyModel, 'name', 'Jim Bob');
  let dummyChangeset = new Changeset(dummyModel);
  set(dummyChangeset, 'name', '');
  let result = get(dummyChangeset, 'name');

  assert.equal(result, '', 'should proxy to change');
});

test('#set adds a change if valid', function(assert) {
  let expectedChanges = [{ key: 'name', value: 'foo' }];
  let dummyChangeset = new Changeset(dummyModel);
  dummyChangeset.set('name', 'foo');
  let changes = get(dummyChangeset, 'changes');

  assert.deepEqual(changes, expectedChanges, 'should add change');
});

test('#set does not add a change if invalid', function(assert) {
  let expectedErrors = [
    { key: 'name', validation: 'too short', value: 'a' },
    { key: 'password', validation: ['foo', 'bar'], value: false }
  ];
  let dummyChangeset = new Changeset(dummyModel, dummyValidator);
  dummyChangeset.set('name', 'a');
  dummyChangeset.set('password', false);
  let changes = get(dummyChangeset, 'changes');
  let errors = get(dummyChangeset, 'errors');
  let isValid = get(dummyChangeset, 'isValid');
  let isInvalid = get(dummyChangeset, 'isInvalid');

  assert.deepEqual(changes, [], 'should not add change');
  assert.deepEqual(errors, expectedErrors, 'should have errors');
  assert.notOk(isValid, 'should not be valid');
  assert.ok(isInvalid, 'should be invalid');
});

test('#set adds the change without validation if `skipValidate` option is set', function(assert) {
  let expectedChanges = [{ key: 'password', value: false }];

  let dummyChangeset = new Changeset(dummyModel, dummyValidator, null, {skipValidate: true});
  dummyChangeset.set('password', false);
  let changes = get(dummyChangeset, 'changes');

  assert.deepEqual(changes, expectedChanges, 'should add change');
});

test('#prepare provides callback to modify changes', function(assert) {
  let date = new Date();
  let dummyChangeset = new Changeset(dummyModel);
  dummyChangeset.set('first_name', 'foo');
  dummyChangeset.set('date_of_birth', date);
  dummyChangeset.prepare((changes) => {
    let modified = {};

    for (let key in changes) {
      modified[dasherize(key)] = changes[key];
    }

    return modified;
  });
  let changeKeys = get(dummyChangeset, 'changes').map((change) => get(change, 'key'));

  assert.deepEqual(changeKeys, ['first-name', 'date-of-birth'], 'should update changes');
  dummyChangeset.execute();
  assert.equal(get(dummyModel, 'first-name'), 'foo', 'should update changes');
  assert.equal(get(dummyModel, 'date-of-birth'), date, 'should update changes');
});

test('#prepare throws if callback does not return object', function(assert) {
  let dummyChangeset = new Changeset(dummyModel);
  dummyChangeset.set('first_name', 'foo');

  assert.throws(() => dummyChangeset.prepare(() => { return 'foo'; }), ({ message }) => {
    return message === 'Assertion Failed: Callback to `changeset.prepare` must return an object';
  }, 'should throw error');
});

test('#execute applies changes to content if valid', function(assert) {
  let dummyChangeset = new Changeset(dummyModel);
  dummyChangeset.set('name', 'foo');

  assert.equal(get(dummyModel, 'name'), undefined, 'precondition');
  assert.ok(get(dummyChangeset, 'isValid'), 'should be valid');
  dummyChangeset.execute();
  assert.equal(get(dummyModel, 'name'), 'foo', 'should apply changes');
});

test('#execute does not apply changes to content if invalid', function(assert) {
  let dummyChangeset = new Changeset(dummyModel, dummyValidator);
  dummyChangeset.set('name', 'a');

  assert.equal(get(dummyModel, 'name'), undefined, 'precondition');
  assert.ok(get(dummyChangeset, 'isInvalid'), 'should be invalid');
  dummyChangeset.execute();
  assert.equal(get(dummyModel, 'name'), undefined, 'should not apply changes');
});

test('#save proxies to content', function(assert) {
  let result;
  let options;
  let done = assert.async();
  set(dummyModel, 'save', (dummyOptions) => {
    result = 'ok';
    options = dummyOptions;
    return resolve('saveResult');
  });
  let dummyChangeset = new Changeset(dummyModel);
  dummyChangeset.set('name', 'foo');

  assert.equal(result, undefined, 'precondition');
  let promise = dummyChangeset.save('test options');
  assert.equal(result, 'ok', 'should save');
  assert.equal(options, 'test options', 'should proxy options when saving');
  assert.ok(!!promise && typeof promise.then === 'function', 'save returns a promise');
  promise.then((saveResult) => {
    assert.equal(saveResult, 'saveResult', 'save proxies to save promise of content');
  }).finally(() => done());
});

test('#save handles rejected proxy content', function(assert) {
  let done = assert.async();
  let dummyChangeset = new Changeset(dummyModel);

  assert.expect(1);

  set(dummyModel, 'save', () => {
    return new Promise((resolve, reject) => {
      next(null, reject, new Error('some ember data error'));
    });
  });

  run(() => {
    dummyChangeset.save().catch((error) => {
        assert.equal(error.message, 'some ember data error');
      })
      .finally(() => done());
  });
});

test('#save proxies to content even if it does not implement #save', function(assert) {
  let done = assert.async();
  let person = { name: 'Jim' };
  let dummyChangeset = new Changeset(person);
  dummyChangeset.set('name', 'foo');

  return dummyChangeset.save().then(() => {
    assert.equal(get(person, 'name'), 'foo', 'persist changes to content');
    done();
  });
});

test('#rollback restores old values', function(assert) {
  let dummyChangeset = new Changeset(dummyModel, dummyValidator);
  let expectedChanges = [
    { key: 'firstName', value: 'foo' },
    { key: 'lastName', value: 'bar' }
  ];
  let expectedErrors = [{ key: 'name', validation: 'too short', value: '' }];
  dummyChangeset.set('firstName', 'foo');
  dummyChangeset.set('lastName', 'bar');
  dummyChangeset.set('name', '');

  assert.deepEqual(get(dummyChangeset, 'changes'), expectedChanges, 'precondition');
  assert.deepEqual(get(dummyChangeset, 'errors'), expectedErrors, 'precondition');
  dummyChangeset.rollback();
  assert.deepEqual(get(dummyChangeset, 'changes'), [], 'should rollback');
  assert.deepEqual(get(dummyChangeset, 'errors'), [], 'should rollback');
});

test('#rollback resets valid state', function(assert) {
  let dummyChangeset = new Changeset(dummyModel, dummyValidator);
  dummyChangeset.set('name', 'a');

  assert.ok(get(dummyChangeset, 'isInvalid'), 'should be invalid');
  dummyChangeset.rollback();
  assert.ok(get(dummyChangeset, 'isValid'), 'should be valid');
});

test('#error returns the error object', function(assert) {
  let dummyChangeset = new Changeset(dummyModel, dummyValidator);
  let expectedResult = { name: { validation: 'too short', value: 'a' } };
  dummyChangeset.set('name', 'a');

  assert.deepEqual(get(dummyChangeset, 'error'), expectedResult, 'should return error object');
});

test('#change returns the changes object', function(assert) {
  let dummyChangeset = new Changeset(dummyModel);
  let expectedResult = { name: 'a' };
  dummyChangeset.set('name', 'a');

  assert.deepEqual(get(dummyChangeset, 'change'), expectedResult, 'should return changes object');
});

test('#merge merges 2 valid changesets', function(assert) {
  let dummyChangesetA = new Changeset(dummyModel);
  let dummyChangesetB = new Changeset(dummyModel);
  dummyChangesetA.set('firstName', 'Jim');
  dummyChangesetB.set('lastName', 'Bob');
  let dummyChangesetC = dummyChangesetA.merge(dummyChangesetB);
  let expectedChanges = [{ key: 'firstName', value: 'Jim' }, { key: 'lastName', value: 'Bob' }];

  assert.deepEqual(get(dummyChangesetC, 'changes'), expectedChanges, 'should merge 2 valid changesets');
  assert.deepEqual(get(dummyChangesetA, 'changes'), [{ key: 'firstName', value: 'Jim' }], 'should not mutate first changeset');
  assert.deepEqual(get(dummyChangesetB, 'changes'), [{ key: 'lastName', value: 'Bob' }], 'should not mutate second changeset');
});

test('#merge merges invalid changesets', function(assert) {
  let dummyChangesetA = new Changeset(dummyModel, dummyValidator);
  let dummyChangesetB = new Changeset(dummyModel, dummyValidator);
  let dummyChangesetC = new Changeset(dummyModel, dummyValidator);
  dummyChangesetA.set('age', 21);
  dummyChangesetA.set('name', 'a');
  dummyChangesetB.set('name', 'Tony Stark');
  dummyChangesetC.set('name', 'b');

  let dummyChangesetD = dummyChangesetA.merge(dummyChangesetB);
  dummyChangesetD = dummyChangesetD.merge(dummyChangesetC);

  let expectedChanges = [{ key: 'age', value: 21 }];
  let expectedErrors = [{ key: 'name', 'validation': 'too short', value: 'b' }];

  assert.deepEqual(get(dummyChangesetA, 'isInvalid'), true, 'changesetA is not valid becuase of name');
  assert.deepEqual(get(dummyChangesetB, 'isValid'), true, 'changesetB should be invalid');
  assert.deepEqual(get(dummyChangesetC, 'isInvalid'), true, 'changesetC should be invalid');
  assert.deepEqual(get(dummyChangesetD, 'isInvalid'), true, 'changesetD should be invalid');
  assert.deepEqual(get(dummyChangesetD, 'changes'), expectedChanges, 'should not merge invalid changes');
  assert.deepEqual(get(dummyChangesetD, 'errors'), expectedErrors, 'should assign errors from both changesets');
});

test('#merge does not merge a changeset with a non-changeset', function(assert) {
  let dummyChangesetA = new Changeset(dummyModel, dummyValidator);
  let dummyChangesetB = { _changes: { name: 'b' } };
  dummyChangesetA.set('name', 'a');

  assert.throws(() => dummyChangesetA.merge(dummyChangesetB), ({ message }) => {
    return message === 'Assertion Failed: Cannot merge with a non-changeset';
  }, 'should throw error');
});

test('#merge does not merge a changeset with different content', function(assert) {
  let dummyChangesetA = new Changeset(dummyModel, dummyValidator);
  let dummyChangesetB = new Changeset(EmberObject.create(), dummyValidator);

  assert.throws(() => dummyChangesetA.merge(dummyChangesetB), ({ message }) => {
    return message === 'Assertion Failed: Cannot merge with a changeset of different content';
  }, 'should throw error');
});

test('#merge preserves content and validator of origin changeset', function(assert) {
  let dummyChangesetA = new Changeset(dummyModel, dummyValidator);
  let dummyChangesetB = new Changeset(dummyModel);
  let dummyChangesetC = dummyChangesetA.merge(dummyChangesetB);
  let expectedErrors = [{ key: 'name', validation: 'too short', value: 'a' }];

  dummyChangesetC.set('name', 'a');
  assert.deepEqual(dummyChangesetC.get('errors'), expectedErrors, 'should preserve validator');

  run(() => {
    dummyChangesetC.set('name', 'Jim Bob');
    dummyChangesetC.save().then(() => {
      assert.equal(dummyModel.get('name'), 'Jim Bob', 'should set value on model');
    });
  });
});

test('#validate/0 validates all fields immediately', function(assert) {
  let done = assert.async();
  dummyModel.setProperties({ name: 'J', password: false, options: null });
  let dummyChangeset = new Changeset(dummyModel, dummyValidator, dummyValidations);

  run(() => {
    dummyChangeset.validate().then(() => {
      assert.deepEqual(get(dummyChangeset, 'error.password'), { validation: ['foo', 'bar'], value: false }, 'should validate immediately');
      assert.deepEqual(get(dummyChangeset, 'changes'), [], 'should not set changes');
      assert.equal(get(dummyChangeset, 'errors.length'), 5, 'should have 5 errors');
      done();
    });
  });
});

test('#validate/1 validates a single field immediately', function(assert) {
  let done = assert.async();
  dummyModel.setProperties({ name: 'J', password: '123' });
  let dummyChangeset = new Changeset(dummyModel, dummyValidator, dummyValidations);

  run(() => {
    dummyChangeset.validate('name').then(() => {
      assert.deepEqual(get(dummyChangeset, 'error.name'), { validation: 'too short', value: 'J' }, 'should validate immediately');
      assert.deepEqual(get(dummyChangeset, 'changes'), [], 'should not set changes');
      assert.equal(get(dummyChangeset, 'errors.length'), 1, 'should only have 1 error');
      done();
    });
  });
});

test('#validate works correctly with changeset values', function(assert) {
  let done = assert.async();
  dummyModel.setProperties({ name: undefined, password: false, async: true, passwordConfirmation: false, options: {}});
  let dummyChangeset = new Changeset(dummyModel, dummyValidator, dummyValidations);

  run(() => {
    dummyChangeset.set('name', 'Jim Bob');
    dummyChangeset.validate().then(() => {
      assert.equal(get(dummyChangeset, 'errors.length'), 1, 'should have 1 error');
      assert.equal(get(dummyChangeset, 'errors.0.key'), 'password');
      assert.ok(get(dummyChangeset, 'isInvalid'), 'should be invalid');
    });
  });

  run(() => {
    dummyChangeset.set('passwordConfirmation', true);
    dummyChangeset.validate().then(() => {
      assert.equal(get(dummyChangeset, 'errors.length'), 2, 'should have 2 errors');
      assert.equal(get(dummyChangeset, 'errors.0.key'), 'password');
      assert.equal(get(dummyChangeset, 'errors.1.key'), 'passwordConfirmation');
      assert.ok(get(dummyChangeset, 'isInvalid'), 'should be invalid');
    });
  });

  run(() => {
    dummyChangeset.set('password', true);
    dummyChangeset.set('passwordConfirmation', true);
    dummyChangeset.validate().then(() => {
      assert.equal(get(dummyChangeset, 'errors.length'), 0, 'should have no errors');
      assert.ok(get(dummyChangeset, 'isValid'), 'should be valid');
      done();
    });
  });
});

test('#validate works correctly with complex values', function(assert) {
  let done = assert.async();
  dummyModel.setProperties({});
  let dummyChangeset = new Changeset(dummyModel, dummyValidator, dummyValidations);

  run(() => {
    dummyChangeset.set('options', { persist: true });
    dummyChangeset.validate().then(() => {
      assert.deepEqual(get(dummyChangeset, 'changes.0'), { key: 'options', value: { persist: true }});
      done();
    });
  });
});

test('#validate marks actual valid changes', function(assert) {
  let done = assert.async();
  dummyModel.setProperties({ name: 'Jim Bob', password: true, passwordConfirmation: true, async: true });
  let dummyChangeset = new Changeset(dummyModel, dummyValidator, dummyValidations);

  dummyChangeset.set('name', 'foo bar');
  dummyChangeset.set('password', false);

  run(() => {
    dummyChangeset.validate().then(() => {
      assert.deepEqual(get(dummyChangeset, 'changes'), [{ key: 'name', value: 'foo bar' }]);
      done();
    });
  });
});

test('#validate does not mark changes when nothing has changed', function(assert) {
  let done = assert.async();
  let options = {
    persist: true,
    // test isEqual to ensure we're using Ember.isEqual for comparison
    isEqual(other) {
      return this.persist === other.persist;
    }
  };
  dummyModel.setProperties({ name: 'Jim Bob', password: true, passwordConfirmation: true, async: true, options});
  let dummyChangeset = new Changeset(dummyModel, dummyValidator, dummyValidations);

  dummyChangeset.set('options', options);

  run(() => {
    dummyChangeset.validate().then(() => {
      assert.deepEqual(get(dummyChangeset, 'error'), {});
      assert.deepEqual(get(dummyChangeset, 'changes'), []);
      done();
    });
  });
});

test('#addError adds an error to the changeset', function(assert) {
  let dummyChangeset = new Changeset(dummyModel);
  dummyChangeset.addError('email', {
    value: 'jim@bob.com',
    validation: 'Email already taken'
  });

  assert.ok(get(dummyChangeset, 'isInvalid'), 'should be invalid');
  assert.equal(get(dummyChangeset, 'error.email.validation'), 'Email already taken', 'should add the error');
  dummyChangeset.set('email', 'unique@email.com');
  assert.ok(get(dummyChangeset, 'isValid'), 'should be valid');
});

test('#addError adds an error to the changeset using the shortcut', function (assert) {
  let dummyChangeset = new Changeset(dummyModel);
  dummyChangeset.set('email', 'jim@bob.com');
  dummyChangeset.addError('email', 'Email already taken');

  assert.ok(get(dummyChangeset, 'isInvalid'), 'should be invalid');
  assert.equal(get(dummyChangeset, 'error.email.validation'), 'Email already taken', 'should add the error');
  assert.equal(get(dummyChangeset, 'error.email.value'), 'jim@bob.com', 'addError uses already present value');
  dummyChangeset.set('email', 'unique@email.com');
  assert.ok(get(dummyChangeset, 'isValid'), 'should be valid');
});

test('#pushErrors pushes an error into an array of existing validations', function (assert) {
  let dummyChangeset = new Changeset(dummyModel);
  dummyChangeset.set('email', 'jim@bob.com');
  dummyChangeset.addError('email', 'Email already taken');
  dummyChangeset.pushErrors('email', 'Invalid email format');

  assert.ok(get(dummyChangeset, 'isInvalid'), 'should be invalid');
  assert.deepEqual(get(dummyChangeset, 'error.email.validation'), ['Email already taken', 'Invalid email format'], 'should push the error');
  assert.equal(get(dummyChangeset, 'error.email.value'), 'jim@bob.com', 'pushErrors uses already present value');
  dummyChangeset.set('email', 'unique@email.com');
  assert.ok(get(dummyChangeset, 'isValid'), 'should be valid');
});

test('#pushErrors pushes an error if no existing validations are present', function (assert) {
  let dummyChangeset = new Changeset(dummyModel, dummyValidator);
  dummyChangeset.set('name', 'J');
  dummyChangeset.pushErrors('name', 'cannot be J');

  assert.ok(get(dummyChangeset, 'isInvalid'), 'should be invalid');
  assert.deepEqual(get(dummyChangeset, 'error.name.validation'), ['too short', 'cannot be J'], 'should push the error');
  assert.equal(get(dummyChangeset, 'error.name.value'), 'J', 'pushErrors uses already present value');
  dummyChangeset.set('name', 'Good name');
  assert.ok(get(dummyChangeset, 'isValid'), 'should be valid');
});

test('#snapshot creates a snapshot of the changeset', function(assert) {
  let dummyChangeset = new Changeset(dummyModel, dummyValidator);
  dummyChangeset.set('name', 'Pokemon Go');
  dummyChangeset.set('password', false);
  let snapshot = dummyChangeset.snapshot();
  let expectedResult = {
    changes: { name: 'Pokemon Go' },
    errors: { password: { validation: ['foo', 'bar'], value: false } }
  };

  assert.deepEqual(snapshot, expectedResult, 'should return snapshot');
  dummyChangeset.set('name', "Gotta catch'em all");
  assert.deepEqual(snapshot, expectedResult, 'should not be mutated');
});

test('#restore restores a snapshot of the changeset', function(assert) {
  let dummyChangesetA = new Changeset(dummyModel, dummyValidator);
  let dummyChangesetB = new Changeset(dummyModel, dummyValidator);
  dummyChangesetA.set('name', 'Pokemon Go');
  dummyChangesetA.set('password', false);
  let snapshot = dummyChangesetA.snapshot();

  assert.ok(get(dummyChangesetB, 'isValid'), 'precondition - should be valid');
  dummyChangesetB.restore(snapshot);
  assert.ok(get(dummyChangesetB, 'isInvalid'), 'should be invalid');
  assert.equal(get(dummyChangesetB, 'change.name'), 'Pokemon Go', 'should restore changes');
  assert.deepEqual(get(dummyChangesetB, 'error.password'), { validation: ['foo', 'bar'], value: false }, 'should restore errors');
});

test('#cast allows only specified keys to exist on the changeset', function(assert) {
  let dummyChangeset = new Changeset(dummyModel, dummyValidator);
  let expectedResult = [
    { 'key': 'name', 'value': 'Pokemon Go' },
    { 'key': 'password', 'value': true }
  ];
  let allowed = ['name', 'password'];
  dummyChangeset.set('name', 'Pokemon Go');
  dummyChangeset.set('password', true);
  dummyChangeset.set('unwantedProp', 123);
  dummyChangeset.cast(allowed);

  assert.deepEqual(dummyChangeset.get('changes'), expectedResult, 'should drop `unwantedProp');
  assert.equal(dummyChangeset.get('unwantedProp'), undefined, 'should remove unwanted changes');
});

test('#cast noops if no keys are passed', function(assert) {
  let dummyChangeset = new Changeset(dummyModel, dummyValidator);
  let expectedResult = [
    { 'key': 'name', 'value': 'Pokemon Go' },
    { 'key': 'password', 'value': true },
    { 'key': 'unwantedProp', 'value': 123 }
  ];
  dummyChangeset.set('name', 'Pokemon Go');
  dummyChangeset.set('password', true);
  dummyChangeset.set('unwantedProp', 123);
  dummyChangeset.cast();

  assert.deepEqual(dummyChangeset.get('changes'), expectedResult, 'should drop `unwantedProp');
});

test("isPristine returns true if changes are equal to content's values", function(assert) {
  dummyModel.set('name', 'Bobby');
  dummyModel.set('thing', 123);
  dummyModel.set('nothing', null);
  let dummyChangeset = new Changeset(dummyModel, dummyValidator);
  dummyChangeset.set('name', 'Bobby');
  dummyChangeset.set('nothing', null);

  assert.ok(dummyChangeset.get('isPristine'), 'should be pristine');
});

test("isPristine returns false if changes are not equal to content's values", function(assert) {
  dummyModel.set('name', 'Bobby');
  let dummyChangeset = new Changeset(dummyModel, dummyValidator);
  dummyChangeset.set('name', 'Bobby');
  dummyChangeset.set('thing', 123);

  assert.notOk(dummyChangeset.get('isPristine'), 'should not be pristine');
});

test('isPristine works with `null` values', function(assert) {
  dummyModel.set('name', null);
  dummyModel.set('age', 15);
  let dummyChangeset = new Changeset(dummyModel);

  assert.ok(dummyChangeset.get('isPristine'), 'should be pristine');

  dummyChangeset.set('name', 'Kenny');
  assert.notOk(dummyChangeset.get('isPristine'), 'should not be pristine');

  dummyChangeset.set('name', null);
  assert.ok(dummyChangeset.get('isPristine'), 'should be pristine');
});

test('isValidating returns true when validations have not resolved', function(assert) {
  let dummyChangeset;
  let _validator = () => new Promise(() => {});
  let _validations = {
    reservations() {
      return _validator();
    }
  };

  set(dummyModel, 'reservations', 'ABC12345');
  dummyChangeset = new Changeset(dummyModel, _validator, _validations);

  dummyChangeset.validate();
  assert.ok(dummyChangeset.isValidating(),
    'isValidating should be true when no key is passed in and something is validating');
  assert.ok(dummyChangeset.isValidating('reservations'),
    'isValidating should be true when the key that is passed is validating');
});

test('isValidating returns false when validations have resolved', function(assert) {
  let dummyChangeset;
  let _validator = () => resolve(true);
  let _validations = {
    reservations() {
      return _validator();
    }
  };

  set(dummyModel, 'reservations', 'ABC12345');
  dummyChangeset = new Changeset(dummyModel, _validator, _validations);

  dummyChangeset.validate();
  assert.ok(dummyChangeset.isValidating(),
    'isValidating should be false when no key is passed in and nothing is validating');
  assert.ok(dummyChangeset.isValidating('reservations'),
    'isValidating should be false when the key that is passed in is not validating');
});

test('beforeValidation event is fired before validation', function(assert) {
  let dummyChangeset;
  let _validator = () => new Promise(() => {});
  let _validations = {
    reservations() {
      return _validator();
    }
  };
  let hasFired = false;

  set(dummyModel, 'reservations', 'ABC12345');
  dummyChangeset = new Changeset(dummyModel, _validator, _validations);
  dummyChangeset.on('beforeValidation', () => { hasFired = true; });

  dummyChangeset.validate();
  assert.ok(hasFired, 'beforeValidation should be triggered');
});

test('afterValidation event is fired after validation', function(assert) {
  let dummyChangeset;
  let _validator = () => resolve(true);
  let _validations = {
    reservations() {
      return _validator();
    }
  };
  let hasFired = false;

  set(dummyModel, 'reservations', 'ABC12345');
  dummyChangeset = new Changeset(dummyModel, _validator, _validations);
  dummyChangeset.on('afterValidation', () => { hasFired = true; });

  run(() => {
    dummyChangeset.validate().then(() => {
      assert.ok(hasFired, 'afterValidation should be triggered');
    });
  });
});

test('beforeValidation event is triggered with the key', function(assert) {
  let dummyChangeset;
  let _validator = () => new Promise(() => {});
  let _validations = {
    reservations() {
      return _validator();
    }
  };
  let hasFired = false;

  set(dummyModel, 'reservations', 'ABC12345');
  dummyChangeset = new Changeset(dummyModel, _validator, _validations);
  dummyChangeset.on('beforeValidation', key => {
    if(key === 'reservations') {
      hasFired = true;
    }
  });

  dummyChangeset.validate();
  assert.ok(hasFired, 'beforeValidation should be triggered with the key');
});

test('afterValidation event is triggered with the key', function(assert) {
  let dummyChangeset;
  let _validator = () => resolve(true);
  let _validations = {
    reservations() {
      return _validator();
    }
  };
  let hasFired = false;

  set(dummyModel, 'reservations', 'ABC12345');
  dummyChangeset = new Changeset(dummyModel, _validator, _validations);
  dummyChangeset.on('afterValidation', key => {
    if(key === 'reservations') {
      hasFired = true;
    }
  });

  run(() => {
    dummyChangeset.validate().then(() => {
      assert.ok(hasFired, 'afterValidation should be triggered with the key');
    });
  });
});

// Behavior
test('it works with setProperties', function(assert) {
  let dummyChangeset = new Changeset(dummyModel);
  let expectedResult = [
    { key: 'firstName', value: 'foo' },
    { key: 'lastName', value: 'bar' }
  ];
  dummyChangeset.setProperties({ firstName: 'foo', lastName: 'bar' });

  assert.deepEqual(get(dummyChangeset, 'changes'), expectedResult, 'precondition');
});

test('it accepts async validations', function(assert) {
  let done = assert.async();
  let dummyChangeset = new Changeset(dummyModel, dummyValidator);
  let expectedChanges = [{ key: 'async', value: true }];
  let expectedError = { async: { validation: 'is invalid', value: 'is invalid' } };
  run(() => dummyChangeset.set('async', true));
  run(() => assert.deepEqual(get(dummyChangeset, 'changes'), expectedChanges, 'should set change'));
  run(() => dummyChangeset.set('async', 'is invalid'));
  run(() => {
    assert.deepEqual(get(dummyChangeset, 'error'), expectedError, 'should set error');
    done();
  });
});

test('it clears errors when setting to original value', function(assert) {
  set(dummyModel, 'name', 'Jim Bob');
  let dummyChangeset = new Changeset(dummyModel, dummyValidator);
  dummyChangeset.set('name', '');

  assert.ok(get(dummyChangeset, 'isInvalid'), 'should be invalid');
  dummyChangeset.set('name', 'Jim Bob');
  assert.ok(get(dummyChangeset, 'isValid'), 'should be valid');
  assert.notOk(get(dummyChangeset, 'isInvalid'), 'should be valid');
});

test('it works with nested keys', function(assert) {
  let expectedResult = {
    org: {
      // asia: { sg: 'sg' },
      usa: {
        ca: 'ca',
        // ny: 'ny',
        ma: { name: 'Massachusetts' }
      }
    }
  };
  set(dummyModel, 'org', {
    // asia: { sg: null },
    usa: {
      ca: null,
      ny: null,
      ma: { name: null }
    }
  });
  let dummyChangeset = new Changeset(dummyModel, dummyValidator);
  // dummyChangeset.set('org.asia.sg', 'sg'); // WIP - this is broken
  dummyChangeset.set('org.usa.ca', 'ca');
  dummyChangeset.set('org.usa.ny', '');
  dummyChangeset.set('org.usa.ma', { name: 'Massachusetts' });
  dummyChangeset.execute();
  assert.deepEqual(get(dummyChangeset, 'change'), expectedResult, 'should have correct shape');
  assert.deepEqual(get(dummyModel, 'org'), expectedResult.org, 'should set value');
  assert.deepEqual(get(dummyModel, 'org.asia'), expectedResult.org.asia, 'should set value');
  assert.deepEqual(get(dummyModel, 'org.usa'), expectedResult.org.usa, 'should set value');
  assert.deepEqual(get(dummyModel, 'org.usa.ca'), expectedResult.org.usa.ca, 'should set value');
  assert.deepEqual(get(dummyModel, 'org.usa.ny'), expectedResult.org.usa.ny, 'should set value');
  assert.deepEqual(get(dummyModel, 'org.usa.ma'), expectedResult.org.usa.ma, 'should set value');
  assert.deepEqual(get(dummyModel, 'org.usa.ma.name'), expectedResult.org.usa.ma.name, 'should set value');
});

test('content can be an empty hash', function(assert) {
  assert.expect(1);

  let emptyObject = Object.create(null);
  let dummyChangeset = new Changeset(emptyObject, dummyValidator);

  assert.equal(dummyChangeset.toString(), 'changeset:[object Object]');
});
