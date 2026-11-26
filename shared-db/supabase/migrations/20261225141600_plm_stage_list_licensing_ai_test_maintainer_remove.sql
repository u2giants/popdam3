-- designflow-tracking#127: remove the TEMPORARY live AI tester maintainer (dflow user 74)
-- added by 20261225141500 for the production editor proof. Proof is complete.
UPDATE plm.stage_list
   SET maintainers = array_remove(maintainers, 74)
 WHERE key = 'licensing'
   AND 74 = ANY (maintainers);
