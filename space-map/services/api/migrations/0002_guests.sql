-- Гостевой вход одной кнопкой: у гостя свой аккаунт и своя копия демо-площадки.
ALTER TABLE users ADD COLUMN is_guest boolean NOT NULL DEFAULT false;
CREATE INDEX users_guest_idx ON users(created_at) WHERE is_guest;
