DO $$
DECLARE
	test_player_id integer;
	active_game_title_id integer;
BEGIN
	SELECT id
	INTO test_player_id
	FROM players
	WHERE lower(gamertag) = lower('Utiz23')
	ORDER BY id
	LIMIT 1;

	IF test_player_id IS NULL THEN
		INSERT INTO players (gamertag, position, is_active, first_seen_at, last_seen_at)
		VALUES ('Utiz23', 'center', true, now(), now())
		RETURNING id INTO test_player_id;
	ELSE
		UPDATE players
		SET
			gamertag = 'Utiz23',
			position = COALESCE(position, 'center'),
			is_active = true,
			last_seen_at = now()
		WHERE id = test_player_id;
	END IF;

	INSERT INTO player_gamertag_history (player_id, gamertag, seen_from)
	SELECT test_player_id, 'Utiz23', now()
	WHERE NOT EXISTS (
		SELECT 1
		FROM player_gamertag_history
		WHERE player_id = test_player_id
			AND gamertag = 'Utiz23'
			AND seen_until IS NULL
	);

	INSERT INTO player_profiles (
		player_id,
		jersey_number,
		player_name,
		preferred_position,
		bio,
		club_role_label,
		updated_at
	)
	VALUES (
		test_player_id,
		23,
		'-,Utiz',
		'center',
		'Testing roster member based on a Silkyjoker alt account. Do not treat as a real player profile.',
		'Test User',
		now()
	)
	ON CONFLICT (player_id) DO UPDATE
	SET
		jersey_number = EXCLUDED.jersey_number,
		player_name = EXCLUDED.player_name,
		preferred_position = EXCLUDED.preferred_position,
		bio = EXCLUDED.bio,
		club_role_label = EXCLUDED.club_role_label,
		updated_at = now();

	SELECT id
	INTO active_game_title_id
	FROM game_titles
	WHERE slug = 'nhl26'
	LIMIT 1;

	IF active_game_title_id IS NOT NULL THEN
		INSERT INTO ea_member_season_stats (
			game_title_id,
			gamertag,
			player_id,
			favorite_position,
			games_played,
			skater_gp,
			client_platform,
			last_fetched_at
		)
		VALUES (
			active_game_title_id,
			'Utiz23',
			test_player_id,
			'center',
			0,
			0,
			'test',
			now()
		)
		ON CONFLICT (game_title_id, gamertag) DO UPDATE
		SET
			player_id = EXCLUDED.player_id,
			favorite_position = COALESCE(ea_member_season_stats.favorite_position, EXCLUDED.favorite_position),
			client_platform = COALESCE(ea_member_season_stats.client_platform, EXCLUDED.client_platform),
			last_fetched_at = now();
	END IF;
END $$;
