# GLOBAL REPOSITORY OPERATIONS MANUAL v6.2

## PRIME DIRECTIVE
Modify in place. No duplication. No parallel systems.

## CHANGE PROTOCOL
1. Diagnose
2. Classify
3. Plan
4. Implement
5. Validate
6. Commit
7. Push

## SNAPSHOT MODEL
Snapshot is default.
Patch is restricted.

## SNAPSHOT RULES
- ZIP must be full repo snapshot
- Must include root files
- Must pass validation
- rsync --delete applies

## VALIDATION
npm run validate:all must pass.

## TERMINAL RULE
One command at a time.

## SAFETY
- Always create pre-update tag
- Always support rollback

## FINAL RULE
System must be buildable, validated, reproducible.
