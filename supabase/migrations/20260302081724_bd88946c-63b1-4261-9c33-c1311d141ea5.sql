
-- Fix missing preferred hours on steps 6, 8, 9
UPDATE sequence_steps 
SET preferred_hour_start = 9, preferred_hour_end = 18 
WHERE sequence_id = '8e0e702d-c1d3-4793-9270-67bf454a0b5f' 
  AND preferred_hour_start IS NULL;
