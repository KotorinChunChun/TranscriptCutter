# 移植元

ユーザー提供 `VTT-Dialogue-v3.4-source.zip`（VTT Dialogue 3.4）から、編集ライブラリ、画面、関連テストを移植。
元ZIPは変更せず、クラウド認証・ホスティング・DB・汎用UIライブラリは取り込まない。
デスクトップ固有の読込・保存・確認・動画出力・工程間受渡しはTranscriptCutter側で実装する。
