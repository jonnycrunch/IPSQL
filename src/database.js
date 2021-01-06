import sql from 'node-sql-parser'
import { SQLBase, getNode } from './utils.js'
import { createTable, Table, Where, Row } from './table.js'

const { entries, fromEntries } = Object

class Database extends SQLBase {
  constructor ({ tables, get, cache, chunker, ...opts }) {
    super(opts)
    this.get = get
    this.cache = cache
    this.tables = tables
    this.chunker = chunker
  }

  createTable (ast) {
    return createTable(this, ast)
  }

  async encodeNode () {
    const promises = entries(this.tables).map(async ([key, value]) => {
      return [key, await value.address]
    })
    const tables = fromEntries(await Promise.all(promises))
    return { tables }
  }

  static create (opts) {
    return new Database({ tables: {}, ...opts })
  }

  static async from (cid, { get, cache, chunker }) {
    const create = async (block) => {
      let { tables } = block.value
      const promises = entries(tables).map(async ([key, cid]) => {
        return [key, await Table.from(cid, key, { get, cache, chunker })]
      })
      tables = fromEntries(await Promise.all(promises))
      return new Database({ tables, get, cache, block, chunker })
    }
    return getNode(cid, get, cache, create)
  }

  sql (q, opts) {
    return sqlQuery(q, { ...opts, database: this })
  }
}

const parse = query => (new sql.Parser()).astify(query)

const notsupported = select => {
  const keys = [
    'options',
    'distinct',
    'groupby',
    'having',
    'limit',
    'for_update'
  ]
  keys.forEach(key => {
    if (select[key] !== null) throw new Error(`Not supported "${key}"`)
  })
}

const runSelect = async function * (select) {
  for await (const { entry, table } of select.where()) {
    const result = await select.columns(entry, table)
    yield { entry, table, ...result }
  }
}

const runWhere = async function * (select) {
  const tables = select.ast.from.map(({ table }) => select.db.tables[table])
  if (select.ast.where === null) {
    for (const table of tables) {
      if (!table.rows) continue
      const iter = await table.rows.getAllEntries()
      for (const entry of iter) {
        yield { entry, table }
      }
    }
  } else {
    for (const table of tables) {
      if (!table.rows) continue
      const w = new Where(select.db, select.ast.where, table)
      const results = await w.all()
      yield * results.map(entry => ({ entry, table }))
    }
  }
}

class Select {
  constructor (db, ast) {
    notsupported(ast)
    this.db = db
    this.ast = ast
  }

  async columns (entry, table) {
    const { value } = entry
    const { get, cache } = this.db
    const create = block => new Row({ block, table })
    const row = await getNode(value, get, cache, create)
    return { row, columns: row.columns(this.ast.columns) }
  }

  where () {
    return runWhere(this)
  }

  run () {
    return runSelect(this)
  }

  async _all () {
    let results = []
    for await (const result of this.run()) {
      results.push(result)
    }
    if (this.ast.orderby) {
      results = results.sort((a, b) => {
        for (const order of this.ast.orderby) {
          if (order.expr.type !== 'column_ref') throw new Error('Not Implemented')
          const { column } = order.expr
          const [aa, bb] = [a.row.get(column), b.row.get(column)]
          if (aa < bb) return order.type === 'ASC' ? -1 : 1
          if (aa > bb) return order.type === 'ASC' ? 1 : -1
        }
        return 0
      })
    }
    return results
  }

  async all (full) {
    const results = await this._all()
    const ret = data => full ? { result: data } : data

    const _run = () => {
      let data = results.map(r => r.columns)
      if (!this.ast.columns || this.ast.columns === '*') {
        return data
      }
      else {
        if (this.ast.columns.length === 1 && this.ast.columns[0].expr.type === 'aggr_func') {
          const { name } = this.ast.columns[0].expr
          if (name === 'COUNT') return data.length
          data = data.map(([i]) => i)
          if (name === 'MIN' || name === 'MAX') {
            data = data.sort()
            if (name === 'MIN') return data[0]
            if (name === 'MAX') return data[data.length - 1]
          }
          const reduced = data.reduce((a, b) => a + b)
          if (name === 'SUM') return reduced
          if (name === 'AVG') return reduced / data.length
          throw new Error('Not Implemented')
        }
        for (const col of this.ast.columns) {
          const { type } = col.expr
          if (type !== 'column_ref') throw new Error('Not Implemented')
        }
        return data
      }
    }
    return ret(_run())
  }
}

const exec = (ast, { database, chunker }) => {
  const { keyword, type } = ast
  if (keyword === 'table') {
    if (type === 'create') {
      if (!database) throw new Error('No database to create table in')
      return database.createTable(ast)
    }
    throw new Error('Not implemented')
  }
  if (type === 'insert' || type === 'update') {
    if (!database) throw new Error('No database to create table in')
    const [{ db, table: name }] = ast.table
    if (db !== null) throw new Error('Not implemented')
    const table = database.tables[name]
    if (!table) throw new Error(`Missing table '${name}'`)
    return table.insert(ast, { database, chunker })
  }
  if (type === 'select') {
    return new Select(database, ast)
  }
  throw new Error('Not implemented')
}

const sqlQuery = (q, opts) => exec(parse(q), opts)

export { Database, exec, sqlQuery as sql }
