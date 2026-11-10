# Create CLI: Both Interactive CLI and direct CLI

> Epic plan for `feature/create-cli`. Each task below gets its own branch and a PR into `feature/create-cli`.
> Tick a task here (on `feature/create-cli`) once its PR merges. Remove this file before `feature/create-cli`
> merges to `main`, after copying its final contents into that PR's description.

## Interactive CLI

Create a prompt where a user can input queries which will be parsed to interact with the database. This is following SQL as the reference for how it should behave.

Basic understanding is prompt awaits input, a user may type and even press RETURN. Once a query is closed and a line is terminated with a semicolon (`;`) then the query is consumed by the parser and run. The user may terminate their session by typing `/exit` or with CTRL+C.

## Direct CLI

The program can be run with command-line options, directly output to the terminal or even receive queries.

### Additional features

To be considered in this effort or in another feature:

1. Configurable output:
    - Use \[output\] statement within the interactive CLI and select json / csv / dump (export as query)
    - Use CLI arg to select the output type as json / csv / dump (export as query)
2. Show and Describe tables - **moved to its own feature** (see Out of scope below)
3. Multiple databases (also with show and describe) - **moved to its own feature**
4. User-based sessions (implement security and consider encryption as a future feature) - **moved to its own feature**, together with the `-u` / login prompt (see Out of scope below)

## Work Split

- [x] Create basic Interactive input; await query input and add to buffer, be able to exit. (done on `feature/basic-cli`, tick once its PR merges)
- [x] Detect when a query is complete: scan the buffer for open quotes and brackets instead of `endsWith(';')` (which also fires inside an unclosed quote), and trailing `;` is now acceptable for parsing. The continuation prompt shows what is still open, psql-style (e.g. `'>` for an open quote, `(>` for an open bracket).
- [ ] Pass the buffer to the query parser so it can run the queries (`query()`). A parse or runtime error prints a message and returns to the prompt; it never ends the session. Results can print raw for now.
- [ ] Display query results as a table in the interactive CLI (`prettytable`, added here). Table is the default output; handle an empty result and multiple queries in one buffer.
  - Grouped results (3.0, `group by`): a list of `{ field, value | missing: true, rows | groups }` in sorted order.
    First POC: one table per group under a heading (`date = 2024-06-05 (3 rows)`), with nested groups as indented
    headings.
  - Missing vs null vs empty: call the state **missing** (the project's word: "Null and missing fields", `does not
    exist`, groups' `missing: true`). Each state needs a marker that reads without colour or italics (piped output,
    `NO_COLOR`, screen readers); dimming is only extra. Missing: `—` dimmed (or `(missing)`). `null`: `NULL` dimmed.
    `''`: `''`. `0`, `[]`, `{}`: as they are. Make the markers configurable (psql has `\pset null`); optionally a
    one-line legend under a table that has one (`— missing · NULL null`). No ANSI codes when stdout isn't a TTY.
  - prettytable's options aren't checked yet: if it only takes plain strings, put the markers and ANSI codes on the
    cells before handing it the rows.
- [ ] Choose the database: `-d` / `--database <path>` option (and `use <path>` in interactive mode), applied with `configure({ databasePath })`. Default stays `database/` relative to the current directory.
- [ ] Add direct CLI path (`commander`, added here): script takes args (expects `-q` / `--query` as minimum) and will run directly, otherwise opens interactive CLI. Includes `--help` and `--version`.
- [ ] Direct CLI query can be run: prints the result and exits with a non-zero code on error, so scripts can rely on it. (optional) Read queries from piped stdin (`jfsq < seed.txt`) - useful for seeding task-manager.
- [ ] Configurable output context (json/csv/dump), in Interactive mode this can be done with a use-statement, or with an argument before opening. Otherwise, with the query included the output is also considered for the direct CLI. json and csv should work; dump (exporting results as `insert` queries) only needs to be selectable, it does not need to fully function yet.
- [ ] Docs: a CLI section in the README (both modes, options, examples). Follow-up in task-manager once released: point its README's database setup at the CLI.

## Out of scope (tracked as separate features in TASKS.md)

- **Schema statements in the query language** (`create`, `drop`, `describe`, `show`): today the parser only knows `read`, `insert`, `update` and `delete` (`findCommand.ts`, `splitQueries.ts`); `create`/`drop`/`describe` exist only as JS functions. This is a core-library change, not a CLI one, and it is what lets the CLI actually set up a database. Show and Describe tables (Additional features 2) belong there.
- **Multiple databases** (Additional features 3).
- **User sessions, login and security** (Additional features 4): permissions, audit logging, maybe encryption. A cosmetic `-u` / login prompt is left out of this feature, since it would be rewritten once real sessions exist.
- **Dump output that fully works** (results exported as `insert` queries), if it isn't finished here.

## Release

Not part of any task PR: once `feature/create-cli` merges to `main`, a separate release PR bumps the minor version (new feature).
