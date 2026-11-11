import { outputFormats } from './output'

type HelpTopic = {
  // One line for the /help overview
  summary: string
  // The syntax and an example or two, shown by /help <topic>
  text: string
}

// The prompt's own commands, for /help and for the unknown-command error
export const commandList: string = `/output <${outputFormats.join('|')}>, /null <text>, /missing <text>, /help [topic] or /exit`

// Help for each statement (and the clauses that need more room), shown by /help <topic>. Keep in step with the
// README's "Writing queries" section, which has the full rules.
const topics: Record<string, HelpTopic> = {
  read: {
    summary: 'read rows (select, where, group by, sort, limit, offset)',
    text: `read <record>[.<joined>] [select ...] [on ...] [merge ...] [where ...] [group by ...] [sort ...] [limit n] [offset n]

Every clause is optional and comes at most once, in that order.

  read workouts;
  read workouts select date, reps as count where reps > 8;
  read workouts sort date desc, reps limit 10 offset 20;
  read workouts select _id, reps group by date sort date desc;

See also: /help where, /help join`
  },
  insert: {
    summary: 'add one row, or several in brackets',
    text: `insert <record> values <field> = <value>, ...
insert <record> values (<field> = <value>, ...), (...), ...

Several rows in one insert are all or nothing, and much faster than one insert each.

  insert workouts values reps = 10, date = '2024-06-02';
  insert workouts values (reps = 10, date = '2024-06-02'), (reps = 12, date = '2024-06-03');`
  },
  update: {
    summary: 'change fields in the rows that match',
    text: `update <record> set <field> = <value>, ... [where ...]

Without where, every row changes. No joins: only the named record's own fields.

  update workouts set reps = 12 where date = '2024-06-02';`
  },
  delete: {
    summary: 'remove the rows that match',
    text: `delete <record> [where ...]

Without where, every row is removed.

  delete workouts where date = '2024-06-02';`
  },
  where: {
    summary: 'conditions: comparators, null and missing tests, and / or / not, brackets',
    text: `where <field> <comparator> <value> [and|or [not] ...]

Comparators: = != (or <>) > >= < <= in [...] between [low, high] like
  like: % matches any text, _ one character, ignoring case
Null and missing: is null, is not null, exists, does not exist (= null is an error: use is null)
not binds tightest, then and, then or (as in SQL); brackets group.
Strings use 'single' or "double" quotes; arrays are [1, 2].

  read workouts where date = '2024-06-02' and (exercise_id = 1 or exercise_id = 3);
  read exercises where not (name like 'bench%' or name like 'squat%');
  read workouts where note does not exist or note is null;`
  },
  join: {
    summary: 'on (attach matching rows as a list) and merge (copy one match\'s fields)',
    text: `read <record>.<joined> on <record>.<field> = <joined>.<field> [and on ...]
read <record> merge <record>.<field> with <other>.<field> [merge ...]

on attaches the matching rows as a list; and on goes through linking records.
merge copies one matching row's fields onto each row, named entity.field.

  read workouts.exercises on workouts.exercise_id = exercises._id;
  read workouts merge workouts.exercise_id with exercises._id where exercises.name = 'Squat';`
  },
  create: {
    summary: 'create a record: its fields and keys',
    text: `create [if not exists] <record> (<field> <type> [modifiers], ..., [keys])

Types: string, int, boolean, object, array
Modifiers: optional, null / not null, auto (a generated id, string only), default <value>
Keys: primary key (a), unique (a), index (a, b), foreign key (a) references other (b)

  create if not exists workouts (
    _id string auto,
    reps int,
    date string,
    note string optional default '',
    primary key (_id),
    index (date)
  );

For databases, see /help database`
  },
  alter: {
    summary: 'add, drop, rename or modify one field of a record',
    text: `alter <record> add <field> <type> [modifiers]
alter <record> drop <field>
alter <record> rename <field> to <new name>
alter <record> modify <field> <type> [modifiers]

modify gives the field's whole new definition: anything left out is cleared.

  alter workouts add status string default 'planned';
  alter workouts rename date to day;`
  },
  drop: {
    summary: 'remove a record, its rows and indexes',
    text: `drop [if exists] <record>

  drop if exists exercise_muscle;

For databases, see /help database`
  },
  describe: {
    summary: 'a record\'s fields and keys',
    text: `describe <record>

  describe workouts;`
  },
  show: {
    summary: 'show records, show databases',
    text: `show records      the name of every record, in the order they were created
show databases    the databases in the --databases folder`
  },
  database: {
    summary: 'create database, use, show databases, drop database (with --databases)',
    text: `create database [if not exists] <name>
use <name>
show databases
drop database [if exists] <name>

These need jfsq --databases <folder>. use switches the prompt to that database (the prompt shows its name).

  create database copy;
  use copy;`
  }
}

// The prompt's commands, for the /help overview
const commands: Array<[string, string]> = [
  [`/output <${outputFormats.join('|')}>`, 'how results print'],
  ['/null <text>', 'how a table shows null'],
  ['/missing <text>', 'how a table shows a missing field'],
  ['/help [topic]', 'this help, or the syntax of one statement'],
  ['/exit', 'quit (or Ctrl+C on an empty prompt)']
]

/**
 * Indented two-column lines, the second column lined up.
 * @param rows Each a name and what it does
 * @returns {Array<string>}
 */
const columns = (rows: Array<[string, string]>): string[] => {
  const width: number = Math.max(...rows.map(([name]) => name.length))
  return rows.map(([name, description]) => `  ${name.padEnd(width)}  ${description}`)
}

// Other words people may look for, and the topic that covers them
const aliases: Record<string, string> = {
  select: 'read',
  sort: 'read',
  limit: 'read',
  offset: 'read',
  group: 'read',
  on: 'join',
  merge: 'join',
  use: 'database',
  databases: 'database'
}

/**
 * The text /help prints: without a topic, the prompt's commands and a line per topic; with one, that topic's syntax.
 * @param topic What was typed after /help (any case), or nothing
 * @returns {string}
 * @throws {Error} For a topic there is no help for, naming the ones there are
 */
export const helpText = (topic: string = ''): string => {
  const name: string = topic.trim().toLowerCase()
  if (!name) {
    return [
      'End a query with ; and press Enter to run it. A query can span several lines.',
      '',
      'Commands:',
      ...columns(commands),
      '',
      'Topics (/help <topic>):',
      ...columns(Object.entries(topics).map(([key, { summary }]) => [key, summary]))
    ].join('\n')
  }
  const found: HelpTopic | undefined = topics[aliases[name] ?? name]
  if (!found) {
    throw new Error(`No help for "${topic.trim()}": try ${Object.keys(topics).join(', ')}`)
  }
  return found.text
}
