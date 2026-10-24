import sys, json, sqlite3
from pathlib import Path
import pytest
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'ml'))
from prepare import parse,split,FEATURES,DATA,score_export

def test_genuine_dataset_parsing():
    df=parse(DATA)
    assert len(df)==41188
    assert set(df.y.unique())=={'yes','no'}

def test_chronological_split():
    a,b,c=split(parse(DATA))
    assert (len(a),len(b),len(c))==(24712,8238,8238)
    assert a.index.max()<b.index.min() and b.index.max()<c.index.min()
    assert set(a.index).isdisjoint(c.index)

def test_leakage_allowlist():
    assert not set(['y','duration','campaign','emp.var.rate','nr.employed']).intersection(FEATURES)

def test_missing_columns_rejected(tmp_path):
    p=tmp_path/'bad.csv';p.write_text('y;duration\nyes;1\n')
    with pytest.raises(ValueError):parse(p)

def test_invalid_label_rejected(tmp_path):
    df=parse(DATA).head(2).copy();df.loc[0,'y']='maybe'
    p=tmp_path/'bad.csv';df.to_csv(p,sep=';',index=False)
    with pytest.raises(ValueError):parse(p)

def test_export_matches_python_reference():
    art=json.loads((ROOT/'artifacts/baseline.json').read_text())
    for r in json.loads((ROOT/'artifacts/parity.json').read_text()):assert abs(score_export(art,r['features'])-r['expected'])<1e-12

@pytest.fixture
def db():
    con=sqlite3.connect(':memory:');con.executescript((ROOT/'migrations/0001_initial.sql').read_text())
    con.execute("INSERT INTO samples VALUES('uci-00001','{}','historical')")
    con.execute("INSERT INTO runs VALUES('r','h','{}','[]','complete','now',NULL)")
    return con

def prediction(db):
    db.execute("INSERT OR IGNORE INTO predictions VALUES('r','uci-00001','mock','hash','{}','{}','valid','now')")

def test_outcomes_require_saved_prediction(db):
    with pytest.raises(sqlite3.IntegrityError):db.execute("INSERT INTO outcomes VALUES('r','uci-00001',1,'now')")
    prediction(db);db.execute("INSERT INTO outcomes VALUES('r','uci-00001',1,'later')")
    assert db.execute('SELECT outcome FROM outcomes').fetchone()==(1,)

def test_duplicate_persistence_is_idempotent(db):
    prediction(db);prediction(db)
    assert db.execute('SELECT count(*) FROM predictions').fetchone()==(1,)

@pytest.mark.parametrize('statement',["UPDATE predictions SET record_json='tampered'","DELETE FROM predictions"])
def test_predictions_immutable(db,statement):
    prediction(db)
    with pytest.raises(sqlite3.IntegrityError):db.execute(statement)

def test_hidden_labels_not_joined_until_reveal(db):
    prediction(db);db.execute("INSERT INTO hidden_labels VALUES('uci-00001',1)")
    assert db.execute('SELECT o.outcome FROM predictions p LEFT JOIN outcomes o ON p.run_id=o.run_id AND p.sample_id=o.sample_id').fetchone()==(None,)

def test_known_brier_reference():
    assert ((.2-0)**2+(.8-1)**2)/2==pytest.approx(.04)
