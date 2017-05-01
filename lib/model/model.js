'use strict';

const Bluebird = require('bluebird');
const Transformer = require('./transformer');
const Query = require('./query');
const assert = require('../utils/assert');
const SalineError = require('../utils/error');

const ID_FIELD = 'Id';

// private properties
const _tenant = Symbol('tenant');
const _refresh = Symbol('refresh');
const _definitionPromise = Symbol('definitionPromise');
const _attributes = Symbol('attributes');
const _transformer = Symbol('transformer');
const _ignoreErrors = Symbol('ignoreErrors');
const _strictMode = Symbol('strict');

// private methods
const _applyDescribe = Symbol('applyDescribe');

class Model {

  constructor(schema, tenant, options) {
    options = options || {};

    this[_tenant] = tenant;
    this[_refresh] = true;
    this[_definitionPromise] = null;
    this[_attributes] = schema.attributes;
    this[_transformer] = new Transformer(this[_attributes], 'column');
    this[_ignoreErrors] = options.ignoreErrors || false;
    this[_strictMode] = options.hasOwnProperty('strict') ? options.strict : true;

    Object.defineProperties(this, {
      schema: { value: schema },
      connection: { value: tenant.connection },
      objectName: { value: schema.objectName },
      transformer: { get: () => this[_transformer] },
    });

    // add the static methods to the model instance
    this.schema.extendStatic(this);
  }

  getModel(modelName) {
    return this[_tenant].models[modelName];
  }

  callHook(name, value, fn, context) {
    return this.schema.callHook(name, value, fn, context);
  }

  sobject(objectName) {
    return this.connection.getConnection()
      .then((conn) => conn.sobject(objectName || this.objectName));
  }

  clearCache() {
    return this.sobject().then((sobject) => {
      sobject.describe$.clear();
      this[_refresh] = true;
      return sobject;
    });
  }

  describeSobject() {
    return Bluebird.props({
      sobject: this.sobject(),
    });
  }

  create(obj) {
    // TODO support multiple creates?
    // complications:
    // - With mutliple create comes multiple responses. Some can succeed and
    //   some and fail. should we fail the entire promise if one of them fails?
    //   I don't think so, but also letting it go through can suggest that
    //   everything worked. Something to think about
    assert(!Array.isArray(obj), 'multiple creates are not supported at this time');
    let errors = [];

    return this.callHook([ 'save', 'create' ], obj, (modifiedObj) => {
      return this.describeSobject()
        .then((table) => {
          return table.sobject.create(obj)
            .catch(Model.normalizeErrors);
        })
        .then((results) => {
          assert(results.success, results.errors);
          return {
            data: {
              id: results.id,
            },
            errors,
          };
        });
    }, this);

  }

  find(query) {
    return new Query(this, query);
  }

  update(obj) {
    assert(!Array.isArray(obj), 'multiple updates are not supported at this time');
    let errors = [];

    return this.callHook([ 'save', 'update' ], obj, (modifiedObj) => {
      return this.describeSobject()
        .then((table) => {
          assert(obj[ID_FIELD], 'Unable to update without an id');

          return table.sobject.update(obj)
            .catch(Model.normalizeErrors);
        })
        .then((results) => {
          assert(results.success, results.errors);
          return {
            data: {
              id: results.id,
            },
            errors,
          };
        });
    }, this);
  }

  delete(id) {
    assert(!Array.isArray(id), 'multiple deletes are not supported at this time');

    return this.callHook([ 'delete' ], id, (modifiedId) => {
      return this.describeSobject()
        .then((table) => {
          const describe = table.describe;
          const sobject = table.sobject;

          assert(describe.deletable, `Unable to delete "${describe.label}"`);

          return sobject.destroy(modifiedId)
            .catch(Model.normalizeErrors);
        })
        .then((results) => {
          assert(results.success, results.errors);
          return results.id;
        });
    }, this);
  }

  static normalizeErrors(err) {
    // switch (err.name) {
    //   case 'REQUIRED_FIELD_MISSING':
    //     // TODO err.fields is an array of fields that are required
    //     break;
    // }
    throw err;
  }

}

module.exports = Model;
