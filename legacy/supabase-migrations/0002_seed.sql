-- Phase 0: 시드 데이터 (층 3, 재료 15, 손님 6)

insert into public.dungeon_floors (floor_no, name, description, duration_seconds, danger_level) values
  (1, '이끼 낀 입구',   '습하지만 비교적 안전한 던전 초입. 슬라임과 버섯이 많다.', 300,  1),
  (2, '불타는 회랑',    '용암이 흐르는 통로. 열기를 품은 재료가 자란다.',           900,  3),
  (3, '수정 심연',      '마력 결정이 빛나는 깊은 곳. 희귀 재료가 나오지만 위험하다.', 1800, 5);

insert into public.ingredients (code, name, icon, rarity, heat, umami, sweet, mana, toxin, description) values
  ('slime_jelly',     '슬라임 젤리',     'droplet',   'common',    1, 2, 6, 1, 0, '말랑하고 달콤한 점액질.'),
  ('cave_mushroom',   '동굴 버섯',       'sprout',    'common',    0, 7, 1, 1, 1, '진한 감칠맛이 나는 흔한 버섯.'),
  ('goblin_meat',     '고블린 고기',     'drumstick', 'common',    3, 6, 0, 0, 2, '질기지만 든든한 고기.'),
  ('moss_leaf',       '이끼 잎',         'leaf',      'common',    0, 2, 2, 2, 0, '은은한 풀향이 나는 잎.'),
  ('bat_wing',        '박쥐 날개',       'feather',   'common',    1, 4, 0, 2, 3, '바삭하게 튀기면 별미.'),
  ('lava_pepper',     '용암 고추',       'flame',     'common',    9, 2, 0, 1, 1, '입에서 불이 나는 고추.'),
  ('magma_crab',      '마그마 게',       'shell',     'rare',      7, 7, 1, 2, 0, '껍질 속 살이 뜨겁고 짙다.'),
  ('ember_honey',     '불씨 꿀',         'flame-kindling', 'rare', 5, 1, 9, 2, 0, '따뜻하고 진득한 달콤함.'),
  ('salamander_tail', '도롱뇽 꼬리',     'zap',       'common',    8, 5, 0, 3, 2, '구우면 향이 좋은 꼬리.'),
  ('crystal_shard',   '마력 수정 조각',  'gem',       'rare',      0, 0, 2, 9, 1, '씹으면 마력이 번지는 결정.'),
  ('glow_berry',      '발광 열매',       'cherry',    'common',    0, 1, 7, 6, 0, '은은하게 빛나는 달콤한 열매.'),
  ('abyss_eel',       '심연 장어',       'fish',      'rare',      1, 9, 0, 6, 3, '깊은 곳의 기름진 장어.'),
  ('venom_bloom',     '독꽃 꽃잎',       'flower-2',  'common',    0, 1, 3, 3, 9, '아름답지만 강한 독을 품었다.'),
  ('wyrm_scale_salt', '와이번 비늘 소금','sparkles',  'legendary', 4, 8, 0, 8, 0, '전설의 비늘을 갈아 만든 소금.'),
  ('phoenix_egg',     '불사조 알',       'egg',       'legendary', 8, 6, 6, 9, 0, '따뜻한 생명력이 깃든 알.');

-- 출현 층 / 드랍 가중치
insert into public.floor_ingredients (floor_id, ingredient_id, weight)
select f.id, i.id, w.weight
from (values
  (1, 'slime_jelly',     30), (1, 'cave_mushroom',   30), (1, 'goblin_meat',   20),
  (1, 'moss_leaf',       25), (1, 'bat_wing',        15), (1, 'venom_bloom',   10),
  (2, 'goblin_meat',     15), (2, 'bat_wing',        10), (2, 'lava_pepper',   30),
  (2, 'salamander_tail', 25), (2, 'magma_crab',       8), (2, 'ember_honey',    6),
  (3, 'glow_berry',      25), (3, 'venom_bloom',     10), (3, 'crystal_shard', 10),
  (3, 'abyss_eel',        8), (3, 'magma_crab',       4), (3, 'wyrm_scale_salt', 2),
  (3, 'phoenix_egg',      1)
) as w(floor_no, code, weight)
join public.dungeon_floors f on f.floor_no = w.floor_no
join public.ingredients    i on i.code     = w.code;

insert into public.customer_types
  (code, name, race, job, icon, pref_heat, pref_umami, pref_sweet, pref_mana, pref_toxin, budget_min, budget_max, spawn_weight) values
  ('human_warrior', '인간 전사',     '인간',   '전사',   'sword',     4,  6, 1, -2, -6, 20,  60, 30),
  ('elf_mage',      '엘프 마법사',   '엘프',   '마법사', 'wand-sparkles', -2, 2, 4, 9, -4, 30,  90, 15),
  ('dwarf_miner',   '드워프 광부',   '드워프', '광부',   'pickaxe',   6,  7, 0, -3, 0,  15,  50, 25),
  ('halfling_thief','하플링 도적',   '하플링', '도적',   'ghost',     1,  3, 8, 0,  3,  10,  40, 20),
  ('orc_berserker', '오크 광전사',   '오크',   '광전사', 'axe',       8,  5, -2, -4, 5, 20,  70, 10),
  ('beast_hunter',  '수인 사냥꾼',   '수인',   '사냥꾼', 'crosshair', 3,  8, 2, 1, -3,  25,  80, 15);
