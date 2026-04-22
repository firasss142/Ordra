-- ============================================================
-- 006_dexpress_seed.sql
-- Seed data for Dexpress states and places
-- Source: Dexpress API location dump
-- ============================================================

-- ============================================================
-- States (Tunisian governorates as Dexpress knows them)
-- ============================================================

INSERT INTO dexpress_states (id, name) VALUES
  (1, 'Tunis'),
  (2, 'Ariana'),
  (3, 'Ben Arous'),
  (4, 'Manouba'),
  (5, 'Nabeul'),
  (6, 'Zaghouan'),
  (7, 'Bizerte'),
  (8, 'Béja'),
  (9, 'Jendouba'),
  (10, 'Le Kef'),
  (11, 'Siliana'),
  (12, 'Sousse'),
  (13, 'Monastir'),
  (14, 'Mahdia'),
  (15, 'Sfax'),
  (16, 'Kairouan'),
  (17, 'Kasserine'),
  (18, 'Sidi Bouzid'),
  (19, 'Gabès'),
  (20, 'Médenine'),
  (21, 'Tataouine'),
  (22, 'Gafsa'),
  (23, 'Tozeur'),
  (24, 'Kébili');

-- ============================================================
-- Places (cities/localities within each state)
-- ============================================================

-- Tunis (state_id = 1)
INSERT INTO dexpress_places (id, state_id, name) VALUES
  (101, 1, 'Tunis'),
  (102, 1, 'La Marsa'),
  (103, 1, 'Le Bardo'),
  (104, 1, 'La Goulette'),
  (105, 1, 'Carthage'),
  (106, 1, 'Sidi Bou Said'),
  (107, 1, 'Le Kram'),
  (108, 1, 'Sidi Hassine'),
  (109, 1, 'Ettadhamen'),
  (110, 1, 'Médina');

-- Ariana (state_id = 2)
INSERT INTO dexpress_places (id, state_id, name) VALUES
  (201, 2, 'Ariana'),
  (202, 2, 'Raoued'),
  (203, 2, 'La Soukra'),
  (204, 2, 'Sidi Thabet'),
  (205, 2, 'Mnihla'),
  (206, 2, 'Ettadhamen'),
  (207, 2, 'Kalaat El Andalous');

-- Ben Arous (state_id = 3)
INSERT INTO dexpress_places (id, state_id, name) VALUES
  (301, 3, 'Ben Arous'),
  (302, 3, 'Hammam Lif'),
  (303, 3, 'Hammam Chott'),
  (304, 3, 'Radès'),
  (305, 3, 'Ezzahra'),
  (306, 3, 'Mégrine'),
  (307, 3, 'Mourouj'),
  (308, 3, 'Fouchana'),
  (309, 3, 'Mornag'),
  (310, 3, 'Boumhel');

-- Manouba (state_id = 4)
INSERT INTO dexpress_places (id, state_id, name) VALUES
  (401, 4, 'Manouba'),
  (402, 4, 'Den Den'),
  (403, 4, 'Douar Hicher'),
  (404, 4, 'Oued Ellil'),
  (405, 4, 'Tebourba'),
  (406, 4, 'Jedaida'),
  (407, 4, 'Borj El Amri');

-- Nabeul (state_id = 5)
INSERT INTO dexpress_places (id, state_id, name) VALUES
  (501, 5, 'Nabeul'),
  (502, 5, 'Hammamet'),
  (503, 5, 'Korba'),
  (504, 5, 'Kélibia'),
  (505, 5, 'Dar Chaabane'),
  (506, 5, 'Menzel Temime'),
  (507, 5, 'Grombalia'),
  (508, 5, 'Soliman'),
  (509, 5, 'Beni Khiar'),
  (510, 5, 'El Haouaria');

-- Zaghouan (state_id = 6)
INSERT INTO dexpress_places (id, state_id, name) VALUES
  (601, 6, 'Zaghouan'),
  (602, 6, 'Zriba'),
  (603, 6, 'El Fahs'),
  (604, 6, 'Bir Mcherga');

-- Bizerte (state_id = 7)
INSERT INTO dexpress_places (id, state_id, name) VALUES
  (701, 7, 'Bizerte'),
  (702, 7, 'Menzel Bourguiba'),
  (703, 7, 'Menzel Jemil'),
  (704, 7, 'Mateur'),
  (705, 7, 'Ras Jebel'),
  (706, 7, 'Sejnane'),
  (707, 7, 'Utique');

-- Béja (state_id = 8)
INSERT INTO dexpress_places (id, state_id, name) VALUES
  (801, 8, 'Béja'),
  (802, 8, 'Medjez El Bab'),
  (803, 8, 'Nefza'),
  (804, 8, 'Testour'),
  (805, 8, 'Téboursouk');

-- Jendouba (state_id = 9)
INSERT INTO dexpress_places (id, state_id, name) VALUES
  (901, 9, 'Jendouba'),
  (902, 9, 'Bou Salem'),
  (903, 9, 'Tabarka'),
  (904, 9, 'Ain Draham'),
  (905, 9, 'Ghardimaou'),
  (906, 9, 'Fernana');

-- Le Kef (state_id = 10)
INSERT INTO dexpress_places (id, state_id, name) VALUES
  (1001, 10, 'Le Kef'),
  (1002, 10, 'Dahmani'),
  (1003, 10, 'Tajerouine'),
  (1004, 10, 'Sers');

-- Siliana (state_id = 11)
INSERT INTO dexpress_places (id, state_id, name) VALUES
  (1101, 11, 'Siliana'),
  (1102, 11, 'Bou Arada'),
  (1103, 11, 'Gaafour'),
  (1104, 11, 'Makthar');

-- Sousse (state_id = 12)
INSERT INTO dexpress_places (id, state_id, name) VALUES
  (1201, 12, 'Sousse'),
  (1202, 12, 'Msaken'),
  (1203, 12, 'Kalaa Kebira'),
  (1204, 12, 'Hammam Sousse'),
  (1205, 12, 'Akouda'),
  (1206, 12, 'Kalaa Sghira'),
  (1207, 12, 'Enfidha'),
  (1208, 12, 'Sidi Bou Ali'),
  (1209, 12, 'Hergla'),
  (1210, 12, 'Kondar');

-- Monastir (state_id = 13)
INSERT INTO dexpress_places (id, state_id, name) VALUES
  (1301, 13, 'Monastir'),
  (1302, 13, 'Moknine'),
  (1303, 13, 'Jemmal'),
  (1304, 13, 'Ksar Hellal'),
  (1305, 13, 'Téboulba'),
  (1306, 13, 'Sayada'),
  (1307, 13, 'Bembla'),
  (1308, 13, 'Sahline'),
  (1309, 13, 'Zéramdine');

-- Mahdia (state_id = 14)
INSERT INTO dexpress_places (id, state_id, name) VALUES
  (1401, 14, 'Mahdia'),
  (1402, 14, 'Ksour Essef'),
  (1403, 14, 'El Jem'),
  (1404, 14, 'Chebba'),
  (1405, 14, 'Bou Merdes');

-- Sfax (state_id = 15)
INSERT INTO dexpress_places (id, state_id, name) VALUES
  (1501, 15, 'Sfax'),
  (1502, 15, 'Sakiet Ezzit'),
  (1503, 15, 'Sakiet Eddaier'),
  (1504, 15, 'Chihia'),
  (1505, 15, 'Thyna'),
  (1506, 15, 'El Ain'),
  (1507, 15, 'Agareb'),
  (1508, 15, 'Jebeniana'),
  (1509, 15, 'Mahares'),
  (1510, 15, 'Kerkennah');

-- Kairouan (state_id = 16)
INSERT INTO dexpress_places (id, state_id, name) VALUES
  (1601, 16, 'Kairouan'),
  (1602, 16, 'Haffouz'),
  (1603, 16, 'Sbikha'),
  (1604, 16, 'Nasrallah'),
  (1605, 16, 'Oueslatia');

-- Kasserine (state_id = 17)
INSERT INTO dexpress_places (id, state_id, name) VALUES
  (1701, 17, 'Kasserine'),
  (1702, 17, 'Sbeitla'),
  (1703, 17, 'Thala'),
  (1704, 17, 'Feriana'),
  (1705, 17, 'Foussana');

-- Sidi Bouzid (state_id = 18)
INSERT INTO dexpress_places (id, state_id, name) VALUES
  (1801, 18, 'Sidi Bouzid'),
  (1802, 18, 'Regueb'),
  (1803, 18, 'Jelma'),
  (1804, 18, 'Meknassy');

-- Gabès (state_id = 19)
INSERT INTO dexpress_places (id, state_id, name) VALUES
  (1901, 19, 'Gabès'),
  (1902, 19, 'Mareth'),
  (1903, 19, 'Ghannouch'),
  (1904, 19, 'El Hamma'),
  (1905, 19, 'Matmata');

-- Médenine (state_id = 20)
INSERT INTO dexpress_places (id, state_id, name) VALUES
  (2001, 20, 'Médenine'),
  (2002, 20, 'Djerba Houmt Souk'),
  (2003, 20, 'Djerba Midoun'),
  (2004, 20, 'Zarzis'),
  (2005, 20, 'Ben Guerdane'),
  (2006, 20, 'Beni Khedache');

-- Tataouine (state_id = 21)
INSERT INTO dexpress_places (id, state_id, name) VALUES
  (2101, 21, 'Tataouine'),
  (2102, 21, 'Ghomrassen'),
  (2103, 21, 'Remada');

-- Gafsa (state_id = 22)
INSERT INTO dexpress_places (id, state_id, name) VALUES
  (2201, 22, 'Gafsa'),
  (2202, 22, 'Métlaoui'),
  (2203, 22, 'Redeyef'),
  (2204, 22, 'Moulares'),
  (2205, 22, 'El Guettar');

-- Tozeur (state_id = 23)
INSERT INTO dexpress_places (id, state_id, name) VALUES
  (2301, 23, 'Tozeur'),
  (2302, 23, 'Nefta'),
  (2303, 23, 'Degache');

-- Kébili (state_id = 24)
INSERT INTO dexpress_places (id, state_id, name) VALUES
  (2401, 24, 'Kébili'),
  (2402, 24, 'Douz'),
  (2403, 24, 'Souk Lahad');
