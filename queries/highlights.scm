(name) @label

(group sets: (number) @number)
(target (number) @number)
(weight value: (number) @number)
(percent value: (number) @number)
(rpe value: (number) @number)
(rest value: (number) @number)

(unit) @type.builtin
"%" @type.builtin

(rpe "@" @operator)
(weight "@" @operator)
(ask) @operator
(ask_weight) @operator

["/" ","] @punctuation.delimiter
["-"] @operator
