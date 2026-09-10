/**
 * @file OpenFOAM/Helyx dictionary grammar for tree-sitter
 * @license MIT
 *
 * Models the OpenFOAM dictionary file format: a sequence of blocks,
 * key/value entries, and preprocessor-style directives. Comments are
 * extras and never affect brace/paren nesting; quoted strings absorb
 * any embedded delimiter characters.
 */

module.exports = grammar({
  name: "openfoam",

  extras: ($) => [/\s/, $.line_comment, $.block_comment],

  // `identifier '{'` is ambiguous between "named block" and "a bare
  // identifier value immediately followed by a separate anonymous
  // block list element" — resolved via dynamic precedence on `block`
  // below (named-block reading always wins).
  conflicts: ($) => [[$._name, $.value]],

  rules: {
    source_file: ($) => repeat($._item),

    _item: ($) =>
      choice($.directive, $.block, $.entry, $.merge_entry, $.sized_list),

    // block: identifier|dotted-identifier|quoted-string '{' entry* '}',
    // or an anonymous `{ ... }` block (used as a bare list element, e.g.
    // `features ( { file "x.eMesh"; levels ((0.0 7)); } ... )`).
    // A trailing ';' after the closing '}' is tolerated (seen in real
    // Helyx dicts, e.g. `functions { ... };`) even though it's redundant.
    block: ($) =>
      choice(
        prec.dynamic(
          1,
          seq(field("name", $._name), "{", repeat($._item), "}", optional(";")),
        ),
        seq("{", repeat($._item), "}", optional(";")),
      ),

    // entry: key value* ';' — most entries have one or more values, but
    // a bare `keyword;` with no data is valid OpenFOAM dictionary syntax
    // (e.g. `cuttingPatches();`, where the whole thing including the
    // empty parens is one atomic keyword per OpenFOAM's own word
    // tokenizer, which treats `(`/`)`/`,` as ordinary word characters).
    entry: ($) =>
      seq(field("key", $._name), field("value", repeat($.value)), ";"),

    // `$ref;` on its own — merges/includes a referenced sub-dict in
    // place (e.g. `$p_rghFinal;` inside an fvSolution solver block).
    merge_entry: ($) => seq($.dollar_reference, ";"),

    // A count-prefixed top-level list, as used by whole-file list
    // formats like `constant/polyMesh/boundary`, `points`, `faces`:
    // `6\n(\n    patchName { ... }\n    ...\n)`. No trailing ';'.
    sized_list: ($) => seq(field("count", $.number), $.list),

    _name: ($) => choice($.identifier, $.string),

    value: ($) =>
      choice(
        $.number,
        $.dollar_reference,
        $.string,
        $.list,
        $.dimension_set,
        $.identifier,
      ),

    // A parenthesized list of values and/or nested blocks (e.g. a
    // vector `(0 0 0)`, a list of scalars, or `6 ( patchName { ... } ... )`).
    list: ($) => seq("(", repeat(choice($.value, $.block)), ")"),

    // OpenFOAM dimension set, e.g. `[0 1 -1 0 0 0 0]` or `[kg m s]`.
    dimension_set: ($) => seq("[", repeat(choice($.number, $.identifier)), "]"),

    // #include "file"; #inputMode merge; #if 0 ... #else ... #endif;
    // #codeStream { ... }; etc. Modeled as flat, first-class directive
    // nodes rather than nesting conditional bodies structurally —
    // OpenFOAM's own preprocessor doesn't require matching #if/#endif
    // to be balanced within a single file scope in a way that's useful
    // to model here, and callers needing to walk "the tree" don't need
    // conditional-body nesting for hover/completion/diagnostics
    // purposes. Each directive kind takes a fixed (0 or 1 token) arity
    // so the grammar never has to guess whether a following token
    // belongs to the directive or starts the next top-level item.
    directive: ($) =>
      choice(
        $.include_directive,
        $.input_mode_directive,
        $.conditional_directive,
        $.code_stream_directive,
        $.message_directive,
        $.bare_directive,
      ),

    include_directive: ($) =>
      seq(
        field(
          "name",
          choice(
            "#include",
            "#includeIfPresent",
            "#includeEtc",
            "#includeFunc",
          ),
        ),
        field("path", $.string),
      ),

    input_mode_directive: ($) =>
      seq("#inputMode", field("mode", $.identifier)),

    conditional_directive: ($) =>
      choice(
        seq(field("name", choice("#if", "#ifeq", "#elif")), field("condition", $.value)),
        "#else",
        "#endif",
      ),

    code_stream_directive: ($) => seq("#codeStream", field("body", $.block)),

    message_directive: ($) =>
      seq(field("name", choice("#error", "#warning")), field("message", $.string)),

    // Fallback for any other directive (#remove, #eval, etc.). Zero-arity
    // by design: an "optional" trailing value here would be genuinely
    // ambiguous with the next top-level item (nothing marks where a
    // directive's argument list ends other than a fixed arity).
    bare_directive: ($) => field("name", $.directive_name),

    directive_name: (_$) => /#[A-Za-z]+/,

    // Plain bareword (alpha.water, p_rgh, List<vector>, symGaussSeidel),
    // or a call-like composite key/scheme token (div(phi,U), grad(U),
    // arbitrarily nested as in `div(((rho*nuEff)*dev2(T(grad(U)))))`).
    // The call form is a real recursive rule (not a single regex) so
    // nested parens balance correctly and a `)` closing an *enclosing*
    // list is never ambiguous with one belonging to the call.
    identifier: ($) => choice($._bare_word, $.call_key),

    _bare_word: (_$) => /[A-Za-z_][A-Za-z0-9_.:<>+\-]*/,

    // `div(phi,U)`, `grad(U)`, and arbitrarily-nested arithmetic-
    // expression scheme keys like `div(((rho*nuEff)*dev2(T(grad(U)))))`.
    // The opening `(` must be immediately adjacent (no whitespace) —
    // otherwise `phases          (water air);` (a plain key followed by
    // a separate parenthesized list value) would wrongly merge into a
    // single call-key with no value.
    call_key: ($) =>
      prec(1, seq($._bare_word, token.immediate("("), repeat($._call_arg), ")")),

    paren_group: ($) => seq("(", repeat($._call_arg), ")"),

    // `.` is included standalone to support member-call chains like
    // `grad(U).T()` (call_key "grad(U)", literal ".", call_key "T()").
    _call_arg: ($) =>
      choice($.call_key, $.paren_group, $._bare_word, $.number, $.operator, ",", "."),

    operator: (_$) => /[*/+\-|]/,

    number: (_$) => /-?[0-9]+(\.[0-9]*)?([eE][+-]?[0-9]+)?/,

    dollar_reference: (_$) => /\$\{?[A-Za-z_][A-Za-z0-9_.:]*\}?/,

    string: (_$) => /"([^"\\]|\\.)*"/,

    line_comment: (_$) => /\/\/[^\n]*/,

    block_comment: (_$) => /\/\*([^*]|\*+[^*/])*\*+\//,
  },
});
