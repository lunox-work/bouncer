Implement the ticket in `ticket.md`, with your own tests.

- The interface is drafted in `src/task.go`, with bodies that
  `panic("not implemented")`. Keep its exported names and signatures.
- The task's code lives under `src/`, in `package task`. Change it and add
  new files there. The standard library only.
- Write your tests under `tests/own/`, as `_test.go` files in
  `package own` that import `task "task/src"`. `sh sandbox/test.sh own`
  runs them.
- Everything else (`sandbox/`, `go.mod`) is harness, and a submission that
  changes any of it is rejected.
- Acceptance is decided by a separate run of your code against tests that
  are not in this directory; your own tests are not part of it.
- There is no network and nothing to install.

Stop when you consider the ticket implemented. End with a short summary of
what you built.
