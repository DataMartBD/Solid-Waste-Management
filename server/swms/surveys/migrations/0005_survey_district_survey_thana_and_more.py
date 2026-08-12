"""The survey asks where the premises is: district and thana.

Names, not keys, matching `Holding.district` and `Holding.thana` — so a survey
converted into a holding carries its address across whole instead of having it
re-entered at a desk. `options_source` grows two members to match.

Blank on every survey already recorded, and no back-fill: v1 of the form only
ever offered "Sylhet" as a hard-coded option, and the one survey on record was
not asked which thana it was in. Inventing an answer would put words in a
respondent's mouth.

Reversible: going back drops two columns and narrows the choice list, neither of
which anything else reads.
"""

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('surveys', '0004_backfill_survey_agency'),
    ]

    operations = [
        migrations.AddField(
            model_name='survey',
            name='district',
            field=models.CharField(blank=True, max_length=64),
        ),
        migrations.AddField(
            model_name='survey',
            name='thana',
            field=models.CharField(blank=True, max_length=96),
        ),
        migrations.AlterField(
            model_name='question',
            name='options_source',
            field=models.CharField(choices=[('static', 'The options listed on the form'), ('ward', 'Wards, from the catalog'), ('block', 'Blocks of the chosen ward'), ('collector', 'Collectors on record'), ('district', 'Districts, from the national geography'), ('thana', 'Thanas of the chosen district')], default='static', max_length=12),
        ),
    ]
