/* globals describe, it */
import IPSQL from '../src/index.js'
import { bf } from 'chunky-trees/utils'
import { sha256 as hasher } from 'multiformats/hashes/sha2'
import { deepStrictEqual as same } from 'assert'
import cache from '../src/cache.js'

const chunker = bf(256)

const inmem = () => {
  const store = {}
  const get = async cid => {
    const key = cid.toString()
    if (!store[key]) throw new Error('Not found')
    return store[key]
  }
  const put = async block => {
    const key = block.cid.toString()
    store[key] = block
  }
  return { get, put }
}

const mkopts = () => {
  const store = inmem()
  return { ...store, store, cache: cache(), chunker, hasher }
}

const create = async (name, columns) => {
  const opts = mkopts()
  const query = { dt: { create: { name, columns } } }
  const ipsql = await IPSQL.create(query, opts)
  return ipsql.dt.get(name)
}

describe('dag tables', () => {
  it('create dag table', async () => {
    const opts = mkopts()
    const query = { dt: { create: { name: 'test', columns: 'firstname VARCHAR(255)' } } }
    const ipsql = await IPSQL.create(query, opts)
    const test = await ipsql.dt.get('test')
    same(test.table.name, 'test')
  })
  it('insert (no index match)', async () => {
    let table = await create('test', 'firstname VARCHAR(255)')

    const hello = { hello: 'world' }
    table = await table.insert(hello)
    const ret = await table.get(1)
    same(ret, hello)
    same(table.table.name, 'test')

    const column = table.table.columns[0]
    same(column.index, null)
  })

  it('insert twice (no index match)', async () => {
    let table = await create('test', 'firstname VARCHAR(255)')

    const hello = { hello: 'world' }
    table = await table.insert(hello)
    let ret = await table.get(1)
    same(ret, hello)
    same(table.table.name, 'test')

    let column = table.table.columns[0]
    same(column.index, null)

    table = await table.insert(hello)
    ret = await table.get(1)
    same(ret, hello)
    ret = await table.get(2)
    same(ret, hello)
    same(table.table.name, 'test')

    column = table.table.columns[0]
    same(column.index, null)
  })

  it('insert (index match)', async () => {
    let table = await create('test', 'firstname VARCHAR(255)')

    const hello = { firstname: 'hello', lastname: 'world' }
    table = await table.insert(hello)
    const ret = await table.get(1)
    same(ret, hello)
    same(table.table.name, 'test')

    const results = await table.ipsql.read('SELECT firstname FROM test WHERE firstname = "hello"')
    same(results, [['hello']])
  })

  it('insert twice (index match)', async () => {
    let table = await create('test', 'firstname VARCHAR(255)')

    let hello = { firstname: 'hello', lastname: 'world' }
    table = await table.insert(hello)
    const ret = await table.get(1)
    same(ret, hello)
    same(table.table.name, 'test')

    let results = await table.ipsql.read('SELECT firstname FROM test WHERE firstname = "hello"')
    same(results, [['hello']])

    hello = { firstname: 'world', lastname: 'hello' }
    table = await table.insert(hello)

    results = await table.ipsql.read('SELECT firstname FROM test WHERE firstname = "hello"')
    same(results, [['hello']])
    results = await table.ipsql.read('SELECT firstname FROM test WHERE firstname = "world"')
    same(results, [['world']])
  })
})