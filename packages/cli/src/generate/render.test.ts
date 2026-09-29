import assert from "node:assert/strict"
import { test } from "node:test"
import { buildResource } from "./parse"
import { renderController, renderModel, renderView, tableBuilders, VIEW_FILES } from "./render"

const POST = buildResource("post", ["title:string!", "body:text", "published:boolean"])

test("tableBuilders lists only what the table uses, in canonical order", () => {
  assert.deepEqual(tableBuilders(POST), ["table", "id", "string", "text", "boolean", "timestamps"])
  assert.deepEqual(
    tableBuilders(buildResource("invoice", ["amount:real!", "meta:json", "count:integer"])),
    ["table", "id", "integer", "real", "json", "timestamps"],
  )
  assert.deepEqual(tableBuilders(buildResource("note", [])), ["table", "id", "timestamps"])
})

test("renderModel declares id, fields and timestamps + presence only on !", () => {
  const model = renderModel(POST)
  assert.match(model, /import \{ Model, presence \} from "jot-framework"/)
  assert.match(model, /import \{ posts \} from "\.\.\/\.\.\/db\/schema\.ts"/)
  assert.match(model, /export class Post extends Model<typeof posts> \{/)
  assert.match(model, /declare id: number/)
  assert.match(model, /declare title: string$/m)
  assert.match(model, /declare body: string \| null$/m)
  assert.match(model, /declare published: boolean \| null$/m)
  assert.match(model, /declare createdAt: Date/)
  assert.match(model, /declare updatedAt: Date/)
  assert.match(model, /static validations = \{\n {4}title: \[presence\(\)\],\n {2}\}/)
  assert.doesNotMatch(model, /body: \[presence/)

  const optional = renderModel(buildResource("note", ["body:text"]))
  assert.match(optional, /import \{ Model \} from "jot-framework"/)
  assert.match(optional, /static validations = \{\}/)

  const numbers = renderModel(buildResource("invoice", ["amount:real!", "meta:json"]))
  assert.match(numbers, /declare amount: number$/m)
  assert.match(numbers, /declare meta: unknown$/m)
})

test("renderController has the 7 REST actions and guards", () => {
  const controller = renderController(POST)
  for (const action of ["index", "new", "create", "show", "edit", "update", "destroy"]) {
    assert.match(controller, new RegExp(`async ${action}\\(\\) \\{`), action)
  }
  assert.equal(controller.match(/renderNotFound\(\)/g)?.length, 4)
  assert.equal(controller.match(/\{ status: 422 \}/g)?.length, 2)
  assert.match(controller, /paths\.post\(post\.id\)/)
  assert.match(controller, /paths\.posts\(\)/)
  assert.match(controller, /"Post created\."/)
  assert.match(controller, /"Post updated\."/)
  assert.match(controller, /"Post deleted\."/)
  assert.doesNotMatch(controller, /function toNumber/)
  assert.doesNotMatch(controller, /function parseJson/)
})

test("renderController adds local helpers only when the fields need them", () => {
  const numbers = renderController(
    buildResource("invoice", ["amount:real!", "count:integer", "meta:json"]),
  )
  assert.match(
    numbers,
    /function toNumber\(value: string \| undefined\): number \| null \| undefined/,
  )
  assert.match(
    numbers,
    /function toInteger\(value: string \| undefined\): number \| null \| undefined/,
  )
  assert.match(
    numbers,
    /function isValidNumber\(value: string \| undefined, integer: boolean\): boolean/,
  )
  assert.match(numbers, /function parseJson\(value: string \| undefined\): unknown/)
  assert.match(numbers, /amount: toNumber\(this\.params\.amount\) as number/)
  assert.match(numbers, /count: toInteger\(this\.params\.count\)/)
  assert.match(numbers, /meta: parseJson\(this\.params\.meta\)/)
  assert.match(numbers, /invoice\.isValid\(\)/)
  assert.match(numbers, /Amount must be a number/)
  assert.match(numbers, /values: \{ amount: this\.params\.amount, count: this\.params\.count \}/)

  const strings = renderController(buildResource("note", ["body:text"]))
  assert.doesNotMatch(strings, /toNumber|parseJson/)
})

test("renderView generates the five views", () => {
  for (const view of VIEW_FILES) {
    const content = renderView(POST, view)
    assert.ok(content.length > 0, view)
    assert.ok(content.endsWith("}\n") || content.endsWith("}"), view)
  }

  const form = renderView(POST, "_form")
  assert.match(form, /export default function PostForm\(/)
  assert.match(
    form,
    /\{method === "put" \? <input type="hidden" name="_method" value="put" \/> : null\}/,
  )
  assert.match(form, /<input type="hidden" name="_csrf" value=\{csrfToken\} \/>/)
  assert.match(
    form,
    /<input id="published" type="checkbox" name="published" value="1" checked=\{post\.published === true\} \/>/,
  )
  assert.match(form, /<textarea id="body" name="body">\{post\.body \?\? ""\}<\/textarea>/)
  assert.match(form, /post\.errors\.title\.length > 0/)
  assert.doesNotMatch(form, /post\.errors\.body/)

  const edit = renderView(POST, "edit")
  assert.match(edit, /csrfToken: string/)
  assert.match(edit, /csrfToken=\{csrfToken\}/)
  assert.match(edit, /action=\{paths\.post\(post\.id\)\} method="put"/)
  assert.match(edit, /import PostForm from "\.\/_form\.tsx"/)

  const show = renderView(POST, "show")
  assert.match(show, /csrfToken: string/)
  assert.match(show, /<input type="hidden" name="_csrf" value=\{csrfToken\} \/>/)
  assert.match(show, /<input type="hidden" name="_method" value="delete" \/>/)
  assert.match(show, /paths\.editPost\(post\.id\)/)
  assert.match(show, /<dd>\{post\.published \? "Yes" : "No"\}<\/dd>/)

  const index = renderView(POST, "index")
  assert.match(index, /\{posts\.length === 0 \? <p>No posts yet\.<\/p> : null\}/)
  assert.match(index, /<a href=\{paths\.newPost\(\)\}>New post<\/a>/)

  const newView = renderView(POST, "new")
  assert.match(newView, /csrfToken: string/)
  assert.match(newView, /csrfToken=\{csrfToken\}/)
  assert.match(newView, /action=\{paths\.posts\(\)\}/)
})

test("renderView handles resources without a text field", () => {
  const invoice = buildResource("invoice", ["amount:real!"])
  const index = renderView(invoice, "index")
  assert.match(index, /<a href=\{paths\.invoice\(invoice\.id\)\}>#\{invoice\.id\}<\/a>/)
  const show = renderView(invoice, "show")
  assert.match(show, /<h1>Invoice #\{invoice\.id\}<\/h1>/)
  assert.match(show, /<dd>\{invoice\.amount\}<\/dd>/)
})

test("renderView names the record prop after the resource (no hardcoded `post`)", () => {
  const invoice = buildResource("invoice", ["amount:real!", "meta:json", "paid:boolean"])
  const form = renderView(invoice, "_form")
  assert.match(form, /export default function InvoiceForm\(\{\n {2}invoice,/)
  assert.match(form, /value=\{values\?\.amount \?\? invoice\.amount \?\? ""\}/)
  assert.match(form, /checked=\{invoice\.paid === true\}/)
  assert.match(form, /invoice\.errors\.amount/)
  assert.doesNotMatch(form, /\bpost\./) // nada de record hardcoded (`post.`); `"post"` do method é ok
  const show = renderView(invoice, "show")
  assert.doesNotMatch(show, /\bpost\./)
  const controller = renderController(invoice)
  assert.match(controller, /const invoice = await Invoice\.find\(String\(this\.params\.id\)\)/)
  assert.doesNotMatch(controller, /\bpost\./)
})

test("renderView uses the table name for views of multi-word resources", () => {
  const blog = buildResource("blog_post", ["title:string!"])
  assert.match(renderView(blog, "index"), /export default function BlogPostsIndex/)
  assert.match(renderView(blog, "new"), /import BlogPostForm from "\.\/_form\.tsx"/)
  assert.match(renderView(blog, "_form"), /export default function BlogPostForm/)
})
